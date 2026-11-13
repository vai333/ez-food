/** Gamification persistence: idempotent XP awards, day stats, chain, quests and badge unlocks. */
import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { addDays, toIst } from "../time";
import { BADGES, XP, computeChain, earnedBadges, levelFor, questProgress, questsFor, type DayStats, type Totals, type XpKind } from "../game/engine";
import { planDayNo } from "../engine/plan";
import type { User } from "./session";

const DONE = ["eaten", "swapped", "emergency"];

/** Returns points actually awarded (0 when this ref was already awarded). */
export async function award(user: User, kind: XpKind, points: number, ref: string, label: string, date = toIst().date): Promise<number> {
  if (points <= 0) return 0;
  const db = await getDb();
  const rows = await db.insert(s.xpLedger).values({ userId: user.id, date, kind, points, ref, label }).onConflictDoNothing().returning({ id: s.xpLedger.id });
  return rows.length ? points : 0;
}

export async function dayStats(user: User, date: string): Promise<DayStats> {
  const db = await getDb();
  const [meals, evs, preps, cks] = await Promise.all([
    db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), eq(s.scheduledMeals.date, date))),
    db.select({ type: s.events.type, payload: s.events.payload, ts: s.events.ts }).from(s.events).where(and(eq(s.events.userId, user.id), eq(s.events.date, date), inArray(s.events.type, ["water_logged", "cook_completed", "morning_ack", "water_removed"]))),
    db.select().from(s.prepTasks).where(and(eq(s.prepTasks.userId, user.id), eq(s.prepTasks.status, "done"), sql`(${s.prepTasks.doneAt} at time zone 'Asia/Kolkata')::date = ${date}`)),
    db.select().from(s.checkins).where(and(eq(s.checkins.userId, user.id), eq(s.checkins.date, date))),
  ]);
  const wake = meals.find((m) => m.slot === "wake");
  const food = meals.filter((m) => m.slot !== "wake");
  const ack = evs.find((e) => e.type === "morning_ack");
  const water = evs.filter((e) => e.type === "water_logged").length - evs.filter((e) => e.type === "water_removed").length;
  return {
    date,
    morningAck: wake?.status === "eaten",
    morningAckMinutes: ack ? toIst(ack.ts).minutes : undefined,
    waterGlasses: Math.max(0, water),
    mealsDone: food.filter((m) => DONE.includes(m.status)).length,
    onTimeMeals: food.filter((m) => m.status === "eaten" && m.actualAt && Math.abs(toIst(m.actualAt).minutes - m.plannedStart) <= 30).length,
    swaps: food.filter((m) => m.status === "swapped").length,
    prepDone: preps.length,
    prepDoneBefore22: preps.filter((p) => p.doneAt && toIst(p.doneAt).minutes < 22 * 60).length,
    checkins: cks.filter((c) => c.kind === "deviation").length,
    cookCompleted: evs.filter((e) => e.type === "cook_completed").length,
    slotsDone: meals.filter((m) => DONE.includes(m.status)).length,
    slotsTotal: meals.length || 4,
    reflection: cks.some((c) => c.kind === "reflection"),
  };
}

export type GameSummary = Awaited<ReturnType<typeof gameSummary>>;

/**
 * Recomputes the game state for today. Side effects (idempotent): awards completed quests, perfect day,
 * and newly earned badges. Returns everything the UI needs, including fresh unlocks for celebration.
 */
export async function gameSummary(user: User, planStart: string | null) {
  const db = await getDb();
  const today = toIst().date;
  const stats = await dayStats(user, today);
  const dayNo = planStart ? planDayNo(planStart, today) : 1;

  // Quests
  const quests = questsFor(today, user.userRef, dayNo).map((q) => questProgress(q, stats));
  for (const q of quests) if (q.done) await award(user, "quest", q.reward, `quest:${today}:${q.id}`, `Quest: ${q.title}`);
  // Perfect day
  if (stats.slotsTotal >= 4 && stats.slotsDone >= stats.slotsTotal) await award(user, "perfect_day", XP.perfect_day, `perfect:${today}`, "Perfect day");

  // Chain from plan start (or first meal) to today
  const start = planStart ?? today;
  const meals = await db.select({ date: s.scheduledMeals.date, status: s.scheduledMeals.status }).from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), gte(s.scheduledMeals.date, start)));
  const byDate = new Map<string, { done: number; total: number }>();
  for (const m of meals) {
    const d = byDate.get(m.date) ?? { done: 0, total: 0 };
    d.total++;
    if (DONE.includes(m.status)) d.done++;
    byDate.set(m.date, d);
  }
  const days = [];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const v = byDate.get(d) ?? { done: 0, total: 4 };
    days.push({ date: d, slotsDone: v.done, slotsTotal: v.total || 4 });
  }
  const chain = computeChain(days, today);

  // XP + level
  const [{ xp }] = await db.select({ xp: sql<number>`coalesce(sum(${s.xpLedger.points}),0)::int` }).from(s.xpLedger).where(eq(s.xpLedger.userId, user.id));
  const level = levelFor(xp);
  const todayXp = (await db.select({ p: s.xpLedger.points }).from(s.xpLedger).where(and(eq(s.xpLedger.userId, user.id), eq(s.xpLedger.date, today)))).reduce((a, r) => a + r.p, 0);

  // Badges
  const totals = await totalsFor(user, chain.best, level.level, start, days);
  const have = new Set((await db.select({ b: s.achievements.badgeId }).from(s.achievements).where(eq(s.achievements.userId, user.id))).map((r) => r.b));
  const newly = earnedBadges(totals).filter((b) => !have.has(b));
  if (newly.length) await db.insert(s.achievements).values(newly.map((badgeId) => ({ userId: user.id, badgeId }))).onConflictDoNothing();
  const unseen = await db.select({ b: s.achievements.badgeId }).from(s.achievements).where(and(eq(s.achievements.userId, user.id), eq(s.achievements.seen, false)));

  return {
    xp,
    todayXp,
    level,
    chain,
    quests,
    stats,
    badges: BADGES.map((b) => ({ id: b.id, title: b.title, detail: b.detail, icon: b.icon, tier: b.tier, earned: have.has(b.id) || newly.includes(b.id) })),
    unseenBadges: unseen.map((u) => u.b),
    daysOnPlan: chain.days.filter((d) => d.state === "counted").length,
  };
}

async function totalsFor(user: User, chainBest: number, level: number, start: string, days: { date: string; slotsDone: number; slotsTotal: number }[]): Promise<Totals> {
  const db = await getDb();
  const ev = await db.select({ type: s.events.type, entityId: s.events.entityId, ts: s.events.ts, date: s.events.date }).from(s.events).where(and(eq(s.events.userId, user.id), inArray(s.events.type, ["morning_ack", "cook_completed", "water_logged", "water_removed"])));
  const meals = await db.select({ status: s.scheduledMeals.status, slot: s.scheduledMeals.slot }).from(s.scheduledMeals).where(eq(s.scheduledMeals.userId, user.id));
  const water = new Map<string, number>();
  for (const e of ev) if (e.type === "water_logged") water.set(e.date, (water.get(e.date) ?? 0) + 1);
  const [{ n: prepDone }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.prepTasks).where(and(eq(s.prepTasks.userId, user.id), eq(s.prepTasks.status, "done")));
  const ledger = await db.select({ kind: s.xpLedger.kind }).from(s.xpLedger).where(eq(s.xpLedger.userId, user.id));
  const [{ n: checkins }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.checkins).where(and(eq(s.checkins.userId, user.id), eq(s.checkins.kind, "deviation")));
  const [{ n: reflections }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.checkins).where(and(eq(s.checkins.userId, user.id), eq(s.checkins.kind, "reflection")));
  const acks = ev.filter((e) => e.type === "morning_ack");
  return {
    meals: meals.filter((m) => m.slot !== "wake" && DONE.includes(m.status)).length,
    morningAcks: acks.length,
    earlyAcks: acks.filter((e) => toIst(e.ts).minutes <= 450).length,
    prepDone,
    maxWaterDay: Math.max(0, ...water.values()),
    cookCompleted: ev.filter((e) => e.type === "cook_completed").length,
    cookedSlugs: ev.filter((e) => e.type === "cook_completed").map((e) => e.entityId ?? ""),
    swaps: meals.filter((m) => m.status === "swapped").length,
    emergencies: meals.filter((m) => m.status === "emergency").length,
    perfectDays: ledger.filter((l) => l.kind === "perfect_day").length,
    chainBest,
    level,
    questsDone: ledger.filter((l) => l.kind === "quest").length,
    checkins,
    luckyBowls: ledger.filter((l) => l.kind === "lucky_bowl").length,
    planDaysCounted: days.filter((d) => d.date >= start && d.slotsDone >= Math.min(3, d.slotsTotal)).length,
    reflections,
  };
}

export async function markBadgesSeen(user: User) {
  const db = await getDb();
  await db.update(s.achievements).set({ seen: true }).where(eq(s.achievements.userId, user.id));
}
