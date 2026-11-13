/**
 * Event capture + learning loop (build prompt §12): events, bandit posteriors, memory chunks, insights, forget.
 * Learning never touches safety constraints; it only reorders already-safe options.
 */
import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { toIst, timeOfDay } from "../time";
import { update, type Posterior } from "../engine/bandit";
import type { User } from "./session";

export async function logEvent(user: User, type: string, opts: { entityType?: string; entityId?: string; payload?: Record<string, unknown>; context?: Record<string, unknown>; clientEventId?: string; at?: Date } = {}) {
  const db = await getDb();
  const at = opts.at ?? new Date();
  const ist = toIst(at);
  await db
    .insert(s.events)
    .values({
      userId: user.id,
      ts: at,
      date: ist.date,
      type,
      entityType: opts.entityType,
      entityId: opts.entityId,
      payload: opts.payload ?? {},
      context: { hourOfDay: ist.hour, timeOfDay: timeOfDay(ist.minutes), ...(opts.context ?? {}) },
      clientEventId: opts.clientEventId,
    })
    .onConflictDoNothing();
}

export async function posteriors(userId: string, prefix?: string): Promise<Map<string, Posterior>> {
  const db = await getDb();
  const rows = await db.select().from(s.preferenceScores).where(prefix ? and(eq(s.preferenceScores.userId, userId), sql`${s.preferenceScores.key} like ${prefix + "%"}`) : eq(s.preferenceScores.userId, userId));
  return new Map(rows.map((r) => [r.key, { alpha: r.alpha, beta: r.beta, n: r.n }]));
}

/** Record an outcome. No-op when the user paused learning or withdrew personalisation consent. */
export async function learn(user: User, key: string, success: boolean, weight = 1) {
  if (user.learningPaused || !user.consentPersonalisation) return;
  const db = await getDb();
  const [cur] = await db.select().from(s.preferenceScores).where(and(eq(s.preferenceScores.userId, user.id), eq(s.preferenceScores.key, key))).limit(1);
  const next = update(cur ? { alpha: cur.alpha, beta: cur.beta, n: cur.n } : undefined, success, weight);
  await db
    .insert(s.preferenceScores)
    .values({ userId: user.id, key, ...next })
    .onConflictDoUpdate({ target: [s.preferenceScores.userId, s.preferenceScores.key], set: { ...next, lastUpdated: new Date() } });
}

export async function remember(user: User, text: string, kind: "preference" | "aversion" | "pattern" | "success_story") {
  if (user.learningPaused || !user.consentPersonalisation) return;
  const db = await getDb();
  const existing = await db.select({ id: s.memoryChunks.id, weight: s.memoryChunks.weight }).from(s.memoryChunks).where(and(eq(s.memoryChunks.userId, user.id), eq(s.memoryChunks.text, text))).limit(1);
  if (existing[0]) {
    await db.update(s.memoryChunks).set({ weight: existing[0].weight + 1 }).where(eq(s.memoryChunks.id, existing[0].id));
    return;
  }
  await db.insert(s.memoryChunks).values({ userId: user.id, text, kind, expiresAt: new Date(Date.now() + 90 * 86400_000) });
}

/** Compact, PII-free preference summary for prompts: top memories decayed by age (half-life 30 days). */
export async function preferenceSummary(userId: string, limit = 6): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(s.memoryChunks).where(eq(s.memoryChunks.userId, userId)).orderBy(desc(s.memoryChunks.createdAt)).limit(60);
  const now = Date.now();
  return rows
    .map((r) => ({ r, score: (r.pinned ? 3 : 1) * r.weight * Math.pow(0.5, (now - r.createdAt.getTime()) / (30 * 86400_000)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r.text)
    .join("; ");
}

export async function forgetLearning(user: User) {
  const db = await getDb();
  await db.delete(s.preferenceScores).where(eq(s.preferenceScores.userId, user.id));
  await db.delete(s.memoryChunks).where(eq(s.memoryChunks.userId, user.id));
  await db.delete(s.userInsights).where(eq(s.userInsights.userId, user.id));
  await logEvent(user, "settings_changed", { payload: { forget: true } });
}

/**
 * Deterministic weekly reflection: aggregates the last 7 days into plain insights with evidence counts.
 * (Gemini rewording is optional and never adds facts; the numbers come from here.)
 */
export async function buildInsights(user: User) {
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 86400_000);
  const ev = await db.select().from(s.events).where(and(eq(s.events.userId, user.id), gte(s.events.ts, since)));
  const cks = await db.select().from(s.checkins).where(and(eq(s.checkins.userId, user.id), gte(s.checkins.ts, since)));
  const out: { insightType: string; summary: string; evidenceCount: number; confidence: number; suggestedAdjustment?: string }[] = [];

  const skipsBySlot = new Map<string, number>();
  for (const e of ev) if (e.type === "meal_skipped") skipsBySlot.set(String(e.payload.slot), (skipsBySlot.get(String(e.payload.slot)) ?? 0) + 1);
  for (const [slot, n] of skipsBySlot) if (n >= 2) out.push({ insightType: "slot", summary: `The ${slot === "breakfast" ? "break-fast" : slot} is the meal that slips most often (${n} times this week).`, evidenceCount: n, confidence: Math.min(0.9, 0.4 + n * 0.1), suggestedAdjustment: slot === "snack" ? "Move the snack reminder 30 minutes later" : "Add a prep reminder the night before" });

  const reasons = new Map<string, number>();
  for (const c of cks) for (const r of c.reasonCodes) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) out.push({ insightType: "timing", summary: `"${top[0].replace(/_/g, " ")}" came up ${top[1]} times as the reason a meal moved.`, evidenceCount: top[1], confidence: 0.6, suggestedAdjustment: top[0] === "no_time" || top[0] === "meeting_ran_late" ? "Keep a quick-assemble option ready for busy days" : undefined });

  const accepted = ev.filter((e) => e.type === "alternative_accepted");
  if (accepted.length >= 2) {
    const tags = new Map<string, number>();
    for (const e of accepted) for (const t of (e.payload.cravings as string[] | undefined) ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
    const t = [...tags.entries()].sort((a, b) => b[1] - a[1])[0];
    if (t) out.push({ insightType: "craving", summary: `When you swap, you usually want something ${t[0]}.`, evidenceCount: t[1], confidence: 0.55 });
  }

  const eaten = ev.filter((e) => e.type === "meal_eaten" || e.type === "alternative_accepted" || e.type === "emergency_option_chosen").length;
  if (eaten >= 5) out.push({ insightType: "win", summary: `${eaten} meals stayed on plan this week, including the adapted ones.`, evidenceCount: eaten, confidence: 0.9 });

  const joints = cks.filter((c) => c.jointComfort != null).map((c) => c.jointComfort!);
  if (joints.length >= 3) out.push({ insightType: "symptom_pattern", summary: `You logged joint comfort ${joints.length} times; average ${(joints.reduce((a, b) => a + b, 0) / joints.length).toFixed(1)} of 5. Patterns, not proof.`, evidenceCount: joints.length, confidence: 0.5 });

  const weekStart = toIst().date;
  await db.delete(s.userInsights).where(and(eq(s.userInsights.userId, user.id), eq(s.userInsights.status, "active"), eq(s.userInsights.modelGenerated, false)));
  if (out.length) await db.insert(s.userInsights).values(out.map((o) => ({ userId: user.id, weekStart, ...o })));
  return out;
}
