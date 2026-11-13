/** Builds and keeps the day's schedule in sync, and assembles the Today screen payload. */
import "server-only";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { addDays, fmtHm, hm, istToUtc, toIst } from "../time";
import { planForDate, planEnd, slotsForDate, slotsForPlanDay, type PlanRow, type WeekMenu } from "../engine/plan";
import { buildDaySchedule, type ScheduleResult } from "../engine/schedule";
import { buildPrepTasks } from "../engine/prep";
import { SLOT_LABEL } from "../seed/plan";
import type { MealSlot, Recipe } from "../types";
import { getPersonalisations, portionContext, userRecipeMap } from "./recipes";
import { hydrationDrink } from "../engine/personalise";
import { gameSummary } from "./game";
import { pickIntervention } from "./interventions";
import type { User } from "./session";

import { userPlans, type UserPlan } from "./plans";
export { userPlans, type UserPlan };

/** The plan week covering today (or the first week, if it hasn't started yet). */
export async function activePlan(userId: string): Promise<UserPlan | null> {
  const plans = await userPlans(userId);
  if (!plans.length) return null;
  return planForDate(plans, toIst().date)?.plan ?? plans[0];
}

/** First day of the user's journey (week 1 start); used for chains and progress. */
export async function journeyStart(userId: string): Promise<string | null> {
  return (await userPlans(userId))[0]?.startDate ?? null;
}

/** Ensure scheduled_meals rows exist for `date` and re-run the scheduler for meals not yet resolved. */
export async function ensureDay(user: User, date: string, reason: string = "initial"): Promise<ScheduleResult | null> {
  const db = await getDb();
  const ctx = planForDate(await userPlans(user.id), date);
  if (!ctx) return null;
  const dayNo = ctx.dayNo;
  const { slots } = slotsForPlanDay(ctx.plan.menu, dayNo);
  const recipes = await userRecipeMap(user);
  const existing = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), eq(s.scheduledMeals.date, date)));
  const bySlot = new Map(existing.map((m) => [m.slot, m]));
  const busy = await db.select().from(s.busyBlocks).where(and(eq(s.busyBlocks.userId, user.id), eq(s.busyBlocks.date, date)));
  const now = toIst();
  const winStart = hm(user.eatingWindowStart), winEnd = hm(user.eatingWindowEnd);

  const food = slots.filter((x) => x.slot !== "wake");
  const result = buildDaySchedule({
    windowStart: winStart,
    windowEnd: winEnd,
    busy: busy.map((b) => ({ start: b.start, end: b.end })),
    notBefore: date === now.date ? now.minutes : undefined,
    meals: food.map((x) => {
      const m = bySlot.get(x.slot);
      const active = Math.max(...x.recipeSlugs.map((r) => recipes.get(r)?.activeMinutes ?? 10));
      const resolved = m && m.status !== "planned";
      const pastAndPlanned = date === now.date && m && m.status === "planned" && m.plannedStart + 45 < now.minutes;
      return {
        slot: x.slot as Exclude<MealSlot, "wake">,
        defaultStart: x.defaultStart,
        prepBuffer: active + 5,
        lockedStart: resolved || pastAndPlanned || m?.shiftReason === "pinned" ? m!.plannedStart : undefined,
      };
    }),
  });

  const rows = [
    { slot: "wake" as const, start: hm(user.learnedWakeTime), end: hm(user.learnedWakeTime) + 10, shift: 0, recipes: slots[0].recipeSlugs },
    ...result.meals.map((m) => ({ slot: m.slot, start: m.start, end: m.end, shift: m.shiftMinutes, recipes: food.find((f) => f.slot === m.slot)!.recipeSlugs })),
  ];
  for (const r of rows) {
    const cur = bySlot.get(r.slot);
    if (!cur) {
      await db.insert(s.scheduledMeals).values({ userId: user.id, date, dayNo, slot: r.slot, plannedRecipes: r.recipes, plannedStart: r.start, plannedEnd: r.end, shiftMinutes: r.shift, shiftReason: r.shift ? reason : null }).onConflictDoNothing();
    } else if (cur.status === "planned" && r.slot !== "wake" && cur.shiftReason !== "pinned" && cur.plannedStart !== r.start) {
      await db.update(s.scheduledMeals).set({ plannedStart: r.start, plannedEnd: r.end, shiftMinutes: r.shift, shiftReason: reason, version: cur.version + 1, updatedAt: new Date() }).where(eq(s.scheduledMeals.id, cur.id));
    }
  }
  return result;
}

/** Sync prep tasks for today + the next two days (soaks for tomorrow, sprouts for the day after). */
export async function syncPrep(user: User) {
  const db = await getDb();
  const now = toIst();
  const plans = await userPlans(user.id);
  const dates = [now.date, addDays(now.date, 1), addDays(now.date, 2)].filter((d) => !!planForDate(plans, d));
  if (!dates.length) return;
  const meals = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), inArray(s.scheduledMeals.date, dates)));
  // Each meal date gets its own portions (calorie target) and units, so "Soak 200 g moong" matches that day's meal.
  const tasks = [];
  for (const d of dates) tasks.push(...buildPrepTasks({ slotsFor: (x) => slotsForDate(plans, x), dates: [d], recipes: await userRecipeMap(user, d), now, mealStarts: new Map(meals.map((m) => [`${m.date}:${m.slot}`, m.plannedStart])) }));
  for (const t of tasks) {
    await db.insert(s.prepTasks).values({ userId: user.id, ...t, recovery: t.recovery ?? null, late: !!t.late }).onConflictDoNothing();
  }
}

export type TodayMeal = {
  id: string;
  slot: MealSlot;
  label: string;
  start: number;
  end: number;
  startLabel: string;
  status: string;
  shiftMinutes: number;
  recipes: Pick<Recipe, "slug" | "titleEn" | "titleHi" | "activeMinutes" | "passiveMinutes" | "art" | "tasteTags" | "addedFatTsp">[];
  actualRecipe: string | null;
};

export async function buildToday(user: User) {
  const db = await getDb();
  const plans = await userPlans(user.id);
  const now = toIst();
  if (!plans.length) return { onboarded: false as const };
  const ctx = planForDate(plans, now.date);
  const plan = ctx?.plan ?? plans[0];
  const dayNo = ctx?.dayNo ?? 0;
  let schedule: ScheduleResult | null = null;
  if (ctx) schedule = await ensureDay(user, now.date);
  await ensureDay(user, addDays(now.date, 1));
  await syncPrep(user);
  const recipes = await userRecipeMap(user);
  const rules = await getPersonalisations(user.id);
  const portion = await portionContext(user, now.date, rules);
  const latest = plans[plans.length - 1];
  const nextWeekPlanned = plans.some((p) => p.startDate > plan.startDate);
  const weekEnd = planEnd(plan);
  const meals = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), eq(s.scheduledMeals.date, now.date))).orderBy(asc(s.scheduledMeals.plannedStart));
  const prep = await db.select().from(s.prepTasks).where(and(eq(s.prepTasks.userId, user.id), eq(s.prepTasks.status, "pending"), lte(s.prepTasks.dateDue, addDays(now.date, 0)), gte(s.prepTasks.mealDate, now.date))).orderBy(asc(s.prepTasks.dateDue), asc(s.prepTasks.timeDue));
  const tonightPrep = await db.select().from(s.prepTasks).where(and(eq(s.prepTasks.userId, user.id), eq(s.prepTasks.status, "pending"), eq(s.prepTasks.dateDue, now.date)));
  const busy = await db.select().from(s.busyBlocks).where(and(eq(s.busyBlocks.userId, user.id), eq(s.busyBlocks.date, now.date)));

  // Hide prep for meals that already started or were resolved.
  const startedSlots = new Set(meals.filter((m) => m.status !== "planned" || m.plannedStart <= now.minutes).map((m) => m.slot));
  const relevant = <T extends { mealDate: string; slot: string }>(p: T) => !(p.mealDate === now.date && startedSlots.has(p.slot));
  const view: TodayMeal[] = meals.map((m) => ({
    id: m.id,
    slot: m.slot as MealSlot,
    label: SLOT_LABEL[m.slot as MealSlot],
    start: m.plannedStart,
    end: m.plannedEnd,
    startLabel: fmtHm(m.plannedStart),
    status: m.status,
    shiftMinutes: m.shiftMinutes,
    actualRecipe: m.actualRecipe,
    recipes: m.plannedRecipes.map((slug) => recipes.get(slug)).filter(Boolean).map((r) => ({ slug: r!.slug, titleEn: r!.titleEn, titleHi: r!.titleHi, activeMinutes: r!.activeMinutes, passiveMinutes: r!.passiveMinutes, art: r!.art, tasteTags: r!.tasteTags, addedFatTsp: r!.addedFatTsp })),
  }));

  // Missed: planned meal with no log 45 min after start → offer emergency (never auto-penalise).
  // After the window closes, unlogged meals quietly become "passed" (no penalty, no late-night food prompts).
  const winEnd = hm(user.eatingWindowEnd);
  const closed = now.minutes >= winEnd;
  if (closed) {
    const passed = view.filter((m) => m.slot !== "wake" && m.status === "planned");
    for (const m of passed) {
      await db.update(s.scheduledMeals).set({ status: "missed" }).where(eq(s.scheduledMeals.id, m.id));
      m.status = "missed";
    }
  }
  const overdue = view.filter((m) => m.slot !== "wake" && m.status === "planned" && now.minutes > m.start + 45);
  // The primary card is the next meal that is still actionable (not one that's long overdue: those get the quick-option row).
  const next = view.find((m) => m.status === "planned" && m.slot !== "wake" && now.minutes <= m.start + 45) ?? null;
  const tomorrowFirst = closed ? slotsForDate(plans, addDays(now.date, 1))?.find((x) => x.slot === "breakfast") : undefined;

  const wakeMeal = view.find((m) => m.slot === "wake");
  const inWake = now.minutes >= hm(user.wakeWindowStart) && now.minutes < hm(user.wakeWindowEnd);
  const morning = wakeMeal && wakeMeal.status === "planned" ? (inWake ? "takeover" : now.minutes < hm(user.eatingWindowStart) ? "banner" : "skip") : "done";
  if (morning === "skip" && wakeMeal && wakeMeal.status === "planned") {
    await db.update(s.scheduledMeals).set({ status: "missed" }).where(eq(s.scheduledMeals.id, wakeMeal.id));
    wakeMeal.status = "missed";
  }

  const redFlag = user.redFlagUntil && user.redFlagUntil > new Date();
  const game = await gameSummary(user, plans[0].startDate);
  const line = await pickIntervention(user.id, { minutes: now.minutes, slot: next?.slot, positive: game.stats.slotsDone > 0 && !overdue.length, seed: `${user.id}:${now.date}:${Math.floor(now.minutes / 90)}` });

  return {
    onboarded: true as const,
    name: user.displayName,
    now: { date: now.date, minutes: now.minutes },
    dayNo,
    planLength: plan.lengthDays,
    weekNo: plan.weekNo,
    menu: ctx ? slotsForPlanDay(plan.menu, dayNo).label : null,
    planStart: plan.startDate,
    weekEnd,
    /** Offer the next-week planning chat from day 6 of the latest week, or once it has ended. */
    planNext: !nextWeekPlanned && plan.id === latest.id && dayNo >= plan.lengthDays - 1,
    weekGoals: plan.goals,
    hydration: hydrationDrink(rules),
    /** ≈ estimates: planned kcal for today's menu (after portions) and the user's target, if any. */
    kcal: { planned: portion.plannedKcal, target: portion.target, factor: portion.factor, clamped: portion.clamped },
    window: { start: hm(user.eatingWindowStart), end: hm(user.eatingWindowEnd) },
    meals: view,
    nextId: next?.id ?? null,
    closed,
    tomorrow: tomorrowFirst ? { time: fmtHm(tomorrowFirst.defaultStart), titles: tomorrowFirst.recipeSlugs.map((r) => recipes.get(r)?.titleEn ?? r) } : null,
    overdueIds: overdue.map((m) => m.id),
    prep: [...prep, ...tonightPrep.filter((t) => !prep.some((p) => p.id === t.id))].filter(relevant).map((p) => ({ id: p.id, instruction: p.instruction, due: fmtHm(p.timeDue), dateDue: p.dateDue, mealDate: p.mealDate, taskType: p.taskType, late: p.late, recovery: p.recovery })),
    busy: busy.map((b) => ({ id: b.id, start: b.start, end: b.end, label: b.label })),
    schedule: schedule && !schedule.feasible ? { feasible: false, reason: schedule.reason, options: schedule.options.map((o) => ({ kind: o.kind, label: o.label })) } : { feasible: true },
    morning,
    redFlag: !!redFlag,
    dinnerCarb: user.dinnerCarb,
    line: { slug: line.slug, text: line.text, type: line.type, attribution: line.attribution ?? null },
    game,
  };
}

export type TodayPayload = Extract<Awaited<ReturnType<typeof buildToday>>, { onboarded: true }>;

export async function planWeek(user: User) {
  const plans = await userPlans(user.id);
  if (!plans.length) return null;
  const db = await getDb();
  const recipes = await userRecipeMap(user);
  const meals = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), gte(s.scheduledMeals.date, plans[0].startDate)));
  const today = toIst().date;
  const weeks = plans.map((plan) => ({
    weekNo: plan.weekNo,
    start: plan.startDate,
    end: planEnd(plan),
    goals: plan.goals,
    summary: plan.summary,
    days: Array.from({ length: plan.lengthDays }, (_, i) => {
      const date = addDays(plan.startDate, i);
      const { label, slots } = slotsForPlanDay(plan.menu, i + 1);
      return {
        dayNo: i + 1,
        date,
        menu: label,
        slots: slots.map((sl) => {
          const m = meals.find((x) => x.date === date && x.slot === sl.slot);
          const slugs = m?.plannedRecipes ?? sl.recipeSlugs;
          return { slot: sl.slot, label: SLOT_LABEL[sl.slot], time: fmtHm(m?.plannedStart ?? sl.defaultStart), status: m?.status ?? "upcoming", recipes: slugs.map((r) => ({ slug: r, title: recipes.get(r)?.titleEn ?? r })) };
        }),
      };
    }),
  }));
  const current = planForDate(plans, today)?.plan.weekNo ?? plans[0].weekNo;
  const prep = await db.select().from(s.prepTasks).where(eq(s.prepTasks.userId, user.id)).orderBy(asc(s.prepTasks.dateDue), asc(s.prepTasks.timeDue));
  return { today, current, weeks, prep: prep.map((p) => ({ id: p.id, instruction: p.instruction, dateDue: p.dateDue, due: fmtHm(p.timeDue), status: p.status, taskType: p.taskType })) };
}

export const utcFor = istToUtc;
