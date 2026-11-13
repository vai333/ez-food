/** User actions. Each one: act → log event → learn → award XP (idempotent) → return what the UI should celebrate. */
import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { hm, toIst, addDays } from "../time";
import { XP, luckyBowl } from "../game/engine";
import { retrieve, whyThis, type CravingQuery } from "../engine/retrieve";
import { rng } from "../engine/bandit";
import { hash32 } from "../game/engine";
import { detectRedFlags } from "../safety/redflags";
import { isShowable } from "../safety/validate";
import type { DeviationType, MealSlot, Recipe, TasteTag } from "../types";
import { PANTRY } from "../seed/pantry";
import { award } from "./game";
import { learn, logEvent, posteriors, preferenceSummary, remember } from "./learning";
import { activePlan, ensureDay } from "./today";
import { userRecipe as getUserRecipe, userRecipeMap } from "./recipes";
import { pickIntervention } from "./interventions";
import { generateAlternatives } from "../ai/pipeline";
import { llmConfigured } from "../env";
import { HttpError, type User } from "./session";

export type Reward = { points: number; label: string; lucky?: number };

async function mealFor(user: User, mealId: string) {
  const db = await getDb();
  const [m] = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.id, mealId), eq(s.scheduledMeals.userId, user.id))).limit(1);
  if (!m) throw new HttpError(404, "not_found", "Meal not found.");
  return m;
}

async function setMeal(user: User, mealId: string, patch: Partial<typeof s.scheduledMeals.$inferInsert>) {
  const db = await getDb();
  await db.update(s.scheduledMeals).set({ ...patch, updatedAt: new Date() }).where(and(eq(s.scheduledMeals.id, mealId), eq(s.scheduledMeals.userId, user.id)));
}

async function reschedule(user: User, date: string, reason: string) {
  const plan = await activePlan(user.id);
  if (plan) return ensureDay(user, date, reason);
  return null;
}

export async function markEaten(user: User, mealId: string): Promise<{ rewards: Reward[] }> {
  const m = await mealFor(user, mealId);
  const now = new Date();
  const ist = toIst(now);
  const rewards: Reward[] = [];
  if (m.status === "eaten") return { rewards };
  await setMeal(user, mealId, { status: "eaten", actualAt: now, actualRecipe: m.plannedRecipes[0] });
  await logEvent(user, m.slot === "wake" ? "morning_ack" : "meal_eaten", { entityType: "meal", entityId: mealId, payload: { slot: m.slot, recipes: m.plannedRecipes } });
  if (m.slot === "wake") {
    const p = await award(user, "morning_ack", XP.morning_ack, `ack:${m.date}`, "Ginger water done");
    if (p) rewards.push({ points: p, label: "Ginger water done" });
    // Learn the wake time: median of the last 7 acks, clamped to the wake window.
    await learnWakeTime(user);
    return { rewards };
  }
  for (const r of m.plannedRecipes) await learn(user, `recipe:${r}`, true);
  const p = await award(user, "meal_eaten", XP.meal_eaten, `meal:${mealId}`, "Meal on plan");
  if (p) rewards.push({ points: p, label: "Meal on plan" });
  if (Math.abs(ist.minutes - m.plannedStart) <= 30) {
    const b = await award(user, "on_time_bonus", XP.on_time_bonus, `ontime:${mealId}`, "On-time combo");
    if (b) rewards.push({ points: b, label: "On-time combo" });
  }
  const lucky = luckyBowl(`${user.id}:${mealId}`);
  if (lucky) {
    const l = await award(user, "lucky_bowl", lucky, `lucky:${mealId}`, "Lucky Bowl!");
    if (l) rewards.push({ points: l, label: "Lucky Bowl!", lucky: l });
  }
  return { rewards };
}

async function learnWakeTime(user: User) {
  const db = await getDb();
  const acks = await db.select({ ts: s.events.ts }).from(s.events).where(and(eq(s.events.userId, user.id), eq(s.events.type, "morning_ack"))).orderBy(desc(s.events.ts)).limit(7);
  if (acks.length < 3 || user.learningPaused) return;
  const mins = acks.map((a) => toIst(a.ts).minutes).sort((a, b) => a - b);
  const med = mins[Math.floor(mins.length / 2)];
  const clamped = Math.min(Math.max(med, hm(user.wakeWindowStart)), hm(user.wakeWindowEnd));
  const t = `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
  await db.update(s.users).set({ learnedWakeTime: t }).where(eq(s.users.id, user.id));
}

export async function markSkipped(user: User, mealId: string) {
  const m = await mealFor(user, mealId);
  await setMeal(user, mealId, { status: "skipped" });
  await logEvent(user, "meal_skipped", { entityType: "meal", entityId: mealId, payload: { slot: m.slot } });
  for (const r of m.plannedRecipes) await learn(user, `recipe:${r}`, false, 0.5);
  await reschedule(user, m.date, "manual");
  const line = await pickIntervention(user.id, { deviation: "skipped", slot: m.slot as MealSlot, minutes: toIst().minutes, seed: `${mealId}:skip` });
  return { intervention: line };
}

export async function shiftMeal(user: User, mealId: string, minutes: number) {
  const m = await mealFor(user, mealId);
  const start = m.plannedStart + minutes;
  if (start < hm(user.eatingWindowStart) || start + 25 > hm(user.eatingWindowEnd)) throw new HttpError(400, "outside_window", "That would move the meal outside your eating window.");
  await setMeal(user, mealId, { plannedStart: start, plannedEnd: start + 25, shiftMinutes: m.shiftMinutes + minutes, shiftReason: "pinned", version: m.version + 1 });
  await reschedule(user, m.date, "manual"); // later meals re-flow around the pinned one
  await logEvent(user, "schedule_shifted", { entityType: "meal", entityId: mealId, payload: { by: minutes } });
  return { ok: true };
}

/** "Meeting running late +30": block the next 30 min (or a custom block) and re-run the scheduler. */
export async function addBusy(user: User, start: number, end: number, label: string) {
  const db = await getDb();
  const date = toIst().date;
  await db.insert(s.busyBlocks).values({ userId: user.id, date, start, end, label });
  const res = await reschedule(user, date, "calendar_shift");
  await logEvent(user, "schedule_shifted", { payload: { busy: [start, end], feasible: res?.feasible } });
  return { feasible: res?.feasible ?? true, options: res && !res.feasible ? res.options.map((o) => ({ kind: o.kind, label: o.label })) : [] };
}

export async function removeBusy(user: User, id: string) {
  const db = await getDb();
  await db.delete(s.busyBlocks).where(and(eq(s.busyBlocks.id, id), eq(s.busyBlocks.userId, user.id)));
  await reschedule(user, toIst().date, "manual");
  return { ok: true };
}

export async function logWater(user: User, delta: 1 | -1) {
  const ist = toIst();
  const id = crypto.randomUUID();
  await logEvent(user, delta > 0 ? "water_logged" : "water_removed", { clientEventId: id });
  const rewards: Reward[] = [];
  if (delta > 0) {
    const db = await getDb();
    const n = (await db.select({ id: s.events.id }).from(s.events).where(and(eq(s.events.userId, user.id), eq(s.events.date, ist.date), eq(s.events.type, "water_logged")))).length;
    if (n <= XP.water_cap_glasses) {
      const p = await award(user, "water_glass", XP.water_glass, `water:${ist.date}:${n}`, "+1 glass");
      if (p) rewards.push({ points: p, label: "+1 glass" });
    }
  }
  return { rewards };
}

export async function completePrep(user: User, taskId: string) {
  const db = await getDb();
  const [t] = await db.select().from(s.prepTasks).where(and(eq(s.prepTasks.id, taskId), eq(s.prepTasks.userId, user.id))).limit(1);
  if (!t) throw new HttpError(404, "not_found", "Task not found.");
  await db.update(s.prepTasks).set({ status: "done", doneAt: new Date() }).where(eq(s.prepTasks.id, taskId));
  await logEvent(user, "prep_done", { entityType: "prep", entityId: taskId, payload: { type: t.taskType, recipe: t.recipeSlug } });
  await learn(user, `prep_time:${Math.floor(toIst().minutes / 60)}`, true);
  const p = await award(user, "prep_done", XP.prep_done, `prep:${taskId}`, "Prep done: future-you says thanks");
  return { rewards: p ? [{ points: p, label: "Prep done" }] : [] };
}

export async function cookEvent(user: User, kind: "cook_started" | "cook_step_completed" | "cook_completed" | "cook_abandoned", recipeSlug: string, mealId?: string, extra: Record<string, unknown> = {}) {
  await logEvent(user, kind, { entityType: "recipe", entityId: recipeSlug, payload: { mealId, ...extra } });
  const rewards: Reward[] = [];
  if (kind === "cook_completed") {
    const p = await award(user, "cook_completed", XP.cook_completed, `cook:${mealId ?? recipeSlug}:${toIst().date}`, "Chef mode complete");
    if (p) rewards.push({ points: p, label: "Chef mode complete" });
    if (mealId) {
      const m = await mealFor(user, mealId);
      if (m.status === "planned" || m.status === "prepping") {
        if (m.plannedRecipes.includes(recipeSlug)) rewards.push(...(await markEaten(user, mealId)).rewards);
        else rewards.push(...(await acceptAlternative(user, mealId, recipeSlug, [])).rewards);
      }
    }
  }
  if (kind === "cook_started" && mealId) await setMeal(user, mealId, { status: "prepping" });
  return { rewards };
}

/** Personal cook time: median of actual start→complete once ≥ 3 cooks exist. */
export async function personalCookMinutes(user: User, slug: string): Promise<number | null> {
  const db = await getDb();
  const ev = await db.select().from(s.events).where(and(eq(s.events.userId, user.id), eq(s.events.entityId, slug))).orderBy(s.events.ts);
  const durs: number[] = [];
  let start: Date | null = null;
  for (const e of ev) {
    if (e.type === "cook_started") start = e.ts;
    if (e.type === "cook_completed" && start) {
      durs.push((e.ts.getTime() - start.getTime()) / 60000);
      start = null;
    }
  }
  if (durs.length < 3) return null;
  durs.sort((a, b) => a - b);
  return Math.round(durs[Math.floor(durs.length / 2)]);
}

// ---------- Craving Pivot ----------
export async function suggest(user: User, input: { mealId: string; cravings: TasteTag[]; pantry?: string[]; timeBudget?: number; exclude?: string[]; note?: string }) {
  const m = await mealFor(user, input.mealId);
  if (m.slot === "wake") throw new HttpError(400, "fasting", "Before 12:00 it's water, green tea, black coffee or your ginger water.");
  const now = toIst();
  // Same rule as retrieval: suggestions only from 90 min before the window opens until it closes. No AI call outside it.
  if (now.minutes < hm(user.eatingWindowStart) - 90 || now.minutes >= hm(user.eatingWindowEnd)) {
    return { suggestionId: null, source: "curated" as const, aiNote: "Your eating window is closed. Water, green tea or black coffee until 12:00.", candidates: [], spicyNote: null };
  }
  const slot = m.slot as CravingQuery["slot"];
  const pantrySet = input.pantry ? new Set(input.pantry) : await pantryStock(user);
  const post = await posteriors(user.id, "recipe:");
  const recipes = [...(await userRecipeMap(user)).values()];
  const recent = await recentSlugs(user);
  const r = rng(hash32(`${input.mealId}:${(input.exclude ?? []).join(",")}:${input.cravings.join(",")}`));
  const q: CravingQuery = { slot, cravings: input.cravings, timeBudgetMin: input.timeBudget, pantry: pantrySet, nowMinutes: now.minutes, windowStart: hm(user.eatingWindowStart), windowEnd: hm(user.eatingWindowEnd), recentSlugs: recent, excludeSlugs: [...(input.exclude ?? []), ...m.plannedRecipes], strictCapsicum: user.strictCapsicum, allowDoctorOk: false };
  let ranked = retrieve(recipes, q, post, r);
  if (ranked.length < 3) ranked = [...ranked, ...retrieve(recipes, { ...q, pantry: undefined }, post, r).filter((x) => !ranked.some((y) => y.recipe.slug === x.recipe.slug))];
  const strong = ranked.filter((x) => x.strong);
  let source: "curated" | "ai" | "mixed" = "curated";
  let aiNote: string | undefined;

  if (strong.length < 3 && llmConfigured() && !user.redFlagUntil) {
    const gen = await generateAlternatives({
      userId: user.id,
      profileVersion: user.profileVersion,
      slot,
      cravings: input.cravings,
      pantry: [...pantrySet].map((k) => PANTRY.find((p) => p.key === k)?.label ?? k),
      timeBudget: input.timeBudget ?? 30,
      strictCapsicum: user.strictCapsicum,
      windowStart: user.eatingWindowStart,
      windowEnd: user.eatingWindowEnd,
      preferenceSummary: user.consentPersonalisation ? await preferenceSummary(user.id) : "",
      accepted: [],
      rejected: input.exclude ?? [],
      note: user.consentPersonalisation ? input.note : undefined,
    });
    if (gen.recipes.length) {
      const db = await getDb();
      for (const rec of gen.recipes) {
        await db.insert(s.recipes).values({ slug: rec.slug, data: rec, origin: "ai_generated", status: "pending_review", validator: { ok: true }, createdByUser: user.id }).onConflictDoNothing();
      }
      ranked = [...gen.recipes.map((rec) => ({ recipe: rec as Recipe, score: 99, strong: true, reasons: [], pantryCoverage: 1, why: rec.whyThis })), ...ranked];
      source = strong.length ? "mixed" : "ai";
    } else aiNote = gen.error ? "AI suggestions are resting; these are from your curated list." : undefined;
  }

  const top = ranked.slice(0, 3).map((x) => ({
    slug: x.recipe.slug,
    title: x.recipe.titleEn,
    titleHi: x.recipe.titleHi,
    activeMinutes: x.recipe.activeMinutes,
    passiveMinutes: x.recipe.passiveMinutes,
    tasteTags: x.recipe.tasteTags,
    art: x.recipe.art,
    origin: x.recipe.origin,
    why: (x as { why?: string }).why ?? whyThis(x, input.cravings),
    ingredients: x.recipe.ingredients.map((i) => i.name),
  }));
  const suggestionId = crypto.randomUUID();
  for (const t of top) await logEvent(user, "alternative_shown", { entityType: "recipe", entityId: t.slug, payload: { suggestionId, mealId: input.mealId, cravings: input.cravings, origin: t.origin } });
  await logEvent(user, "craving_selected", { payload: { cravings: input.cravings, mealId: input.mealId } });
  return { suggestionId, source, aiNote, candidates: top, spicyNote: input.cravings.includes("spicy") ? "Spicy here comes from pepper and ginger, because chillies are on your avoid list." : null };
}

async function pantryStock(user: User): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select().from(s.pantryItems).where(eq(s.pantryItems.userId, user.id));
  if (!rows.length) return new Set(PANTRY.map((p) => p.key)); // nothing set yet: assume a stocked kitchen
  return new Set(rows.filter((r) => r.inStock).map((r) => r.key));
}

async function recentSlugs(user: User): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ a: s.scheduledMeals.actualRecipe }).from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), gte(s.scheduledMeals.date, addDays(toIst().date, -1))));
  return rows.map((r) => r.a).filter(Boolean) as string[];
}

export async function acceptAlternative(user: User, mealId: string, slug: string, cravings: TasteTag[]) {
  const m = await mealFor(user, mealId);
  const rec = await getUserRecipe(user, slug);
  if (!rec || !isShowable(rec, { strictCapsicum: user.strictCapsicum, allowPendingValid: rec.origin === "ai_generated" })) throw new HttpError(400, "unsafe", "That option didn't pass the safety check.");
  await setMeal(user, mealId, { status: "swapped", actualRecipe: slug, actualAt: new Date() });
  await logEvent(user, "alternative_accepted", { entityType: "recipe", entityId: slug, payload: { mealId, cravings, slot: m.slot } });
  await learn(user, `recipe:${slug}`, true);
  for (const r of m.plannedRecipes) await learn(user, `recipe:${r}`, false, 0.3);
  if (cravings.length) await remember(user, `Likes ${rec.titleEn} when craving ${cravings.join(" + ")} at ${m.slot}`, "preference");
  const rewards: Reward[] = [];
  const p = await award(user, "meal_swapped", XP.meal_swapped, `meal:${mealId}`, "Adapted, still on plan");
  if (p) rewards.push({ points: p, label: "Adapted, still on plan" });
  const lucky = luckyBowl(`${user.id}:${mealId}`);
  if (lucky) {
    const l = await award(user, "lucky_bowl", lucky, `lucky:${mealId}`, "Lucky Bowl!");
    if (l) rewards.push({ points: l, label: "Lucky Bowl!", lucky: l });
  }
  return { rewards };
}

export async function rejectAlternative(user: User, slug: string, reasonCodes: string[]) {
  await logEvent(user, "alternative_rejected", { entityType: "recipe", entityId: slug, payload: { reasonCodes } });
  await learn(user, `recipe:${slug}`, false);
  const rec = await getUserRecipe(user, slug);
  if (rec && reasonCodes.includes("dont_like")) await remember(user, `Doesn't enjoy ${rec.titleEn}`, "aversion");
  return { ok: true };
}

// ---------- Emergency ----------
export async function emergencyOptions(user: User, mealId: string) {
  const m = await mealFor(user, mealId);
  const now = toIst();
  if (now.minutes < hm(user.eatingWindowStart) - 30 || now.minutes >= hm(user.eatingWindowEnd)) {
    return { outsideWindow: true, message: "Your eating window is closed. Water, green tea or black coffee for now; tomorrow's break-fast is at 12:00.", grab: [], assemble: [], order: null };
  }
  await logEvent(user, "emergency_opened", { entityType: "meal", entityId: mealId });
  const post = await posteriors(user.id, "recipe:");
  const r = rng(hash32(`${mealId}:em`));
  const all = [...(await userRecipeMap(user)).values()].filter((x) => isShowable(x, { strictCapsicum: user.strictCapsicum }) && !x.needsDoctorOk);
  const rank = (xs: Recipe[]) => xs.map((x) => ({ x, s: (post.get(`recipe:${x.slug}`) ? post.get(`recipe:${x.slug}`)!.alpha / (post.get(`recipe:${x.slug}`)!.alpha + post.get(`recipe:${x.slug}`)!.beta) : 0.5) + r() * 0.3 })).sort((a, b) => b.s - a.s).map((y) => y.x);
  const grab = rank(all.filter((x) => x.rawGrab)).slice(0, 3);
  const assemble = rank(all.filter((x) => x.quickAssemble && !x.rawGrab)).slice(0, 3);
  const pick = (x: Recipe) => ({ slug: x.slug, title: x.titleEn, activeMinutes: x.activeMinutes, art: x.art, steps: x.steps.map((st) => st.text).slice(0, 3) });
  return {
    outsideWindow: false,
    slot: m.slot,
    grab: grab.map(pick),
    assemble: assemble.map(pick),
    order: {
      note: "No tomato, no potato, no capsicum, no chilli, minimal oil, no butter or cream please.",
      safest: ["Plain moong dal + steamed rice", "Moong dal khichdi (ask: no tomato, no chilli)", "Idli with coconut-free plain chutney (sambar usually has tomato: skip it)", "Curd rice (ask: no green chilli tempering)", "Steamed vegetables + plain roti (no butter)"],
      avoid: ["Gravies and curries (tomato base)", "Anything fried", "Chaat (chilli + potato)", "Paneer butter dishes"],
      links: [
        { label: "Search Swiggy", url: "https://www.swiggy.com/search?query=moong%20dal%20khichdi" },
        { label: "Search Zomato", url: "https://www.zomato.com/search?q=khichdi" },
        { label: "Nearby on Maps", url: "https://www.google.com/maps/search/khichdi+restaurant+near+me" },
      ],
      honesty: "Restaurant food can't be fully verified. Menus vary; please confirm ingredients.",
    },
  };
}

export async function emergencyChoose(user: User, mealId: string, choice: "grab" | "assemble" | "order", slug?: string) {
  const m = await mealFor(user, mealId);
  await setMeal(user, mealId, { status: "emergency", actualRecipe: slug ?? `takeout`, actualAt: new Date() });
  await logEvent(user, "emergency_option_chosen", { entityType: "meal", entityId: mealId, payload: { choice, slug, slot: m.slot } });
  if (slug) await learn(user, `recipe:${slug}`, true);
  await learn(user, `emergency:${choice}`, true);
  await reschedule(user, m.date, "emergency");
  const p = await award(user, "emergency_choice", XP.emergency_choice, `meal:${mealId}`, "Handled it, calmly");
  const line = await pickIntervention(user.id, { deviation: "emergency", slot: m.slot as MealSlot, minutes: toIst().minutes, seed: `${mealId}:em` });
  return { rewards: p ? [{ points: p, label: "Handled it, calmly" }] : [], intervention: line };
}

// ---------- Check-ins ----------
export async function submitCheckin(user: User, input: { mealId?: string; kind: "deviation" | "reflection" | "unwell"; deviationType?: DeviationType; reasonCodes: string[]; reasonText?: string; mood?: number; hunger?: number; energy?: number; jointComfort?: number; digestion?: number; symptomFlags: string[]; answers?: Record<string, string>; interventionShown?: string; interventionHelped?: boolean }) {
  const db = await getDb();
  const text = [input.reasonText ?? "", ...Object.values(input.answers ?? {})].join(" ");
  const rf = detectRedFlags(text);
  const unwell = input.kind === "unwell";
  const ist = toIst();
  await db.insert(s.checkins).values({
    userId: user.id,
    date: ist.date,
    mealId: input.mealId,
    kind: input.kind,
    deviationType: input.deviationType,
    reasonCodes: input.reasonCodes,
    reasonText: user.consentPersonalisation ? input.reasonText?.slice(0, 1000) : null,
    mood: input.mood,
    hunger: input.hunger,
    energy: input.energy,
    jointComfort: input.jointComfort,
    digestion: input.digestion,
    symptomFlags: input.symptomFlags,
    answers: input.answers ?? {},
    interventionShown: input.interventionShown,
    interventionHelped: input.interventionHelped,
    redFlag: rf.flagged,
  });
  await logEvent(user, "checkin_submitted", { payload: { kind: input.kind, reasons: input.reasonCodes, redFlag: rf.flagged } });
  if (input.interventionShown && input.interventionHelped !== undefined) {
    const { INTERVENTIONS } = await import("../seed/interventions");
    const it = INTERVENTIONS.find((i) => i.slug === input.interventionShown);
    if (it) {
      await learn(user, `tone:${it.tone}`, input.interventionHelped);
      await learn(user, `itype:${it.type}`, input.interventionHelped);
    }
  }
  if (rf.flagged) {
    await db.update(s.users).set({ redFlagUntil: new Date(Date.now() + 24 * 3600_000) }).where(eq(s.users.id, user.id));
    await logEvent(user, "red_flag_triggered", { payload: { matches: rf.matches.map((m) => m.key) } });
    // Suspend pending nudges.
    await db.update(s.notificationQueue).set({ status: "cancelled" }).where(and(eq(s.notificationQueue.userId, user.id), eq(s.notificationQueue.status, "pending")));
  }
  const rewards: Reward[] = [];
  if (input.kind === "reflection") {
    const p = await award(user, "reflection", XP.reflection, `reflect:${ist.date}`, "Day reflected");
    if (p) rewards.push({ points: p, label: "Day reflected" });
  } else if (input.kind === "deviation") {
    const p = await award(user, "checkin", XP.checkin, `checkin:${input.mealId ?? ist.date}`, "Honest log");
    if (p) rewards.push({ points: p, label: "Honest log" });
  }
  const fastingValve = (unwell || rf.fastingDiscomfort) && ist.minutes < hm(user.eatingWindowStart);
  return { redFlag: rf.flagged, matches: rf.matches, fastingValve, rewards };
}

/** Safety valve: break the fast early with the plan's own snack, logged, no guilt. */
export async function earlyBreak(user: User) {
  const ist = toIst();
  await logEvent(user, "early_break", { payload: { minutes: ist.minutes } });
  const db = await getDb();
  await db.insert(s.checkins).values({ userId: user.id, date: ist.date, kind: "unwell", deviationType: "early_break", reasonCodes: ["felt_unwell"], symptomFlags: ["fasting_discomfort"] });
  return { suggestion: { title: "Papaya + 4 soaked walnuts (or a glass of buttermilk)", note: "It's okay to eat now. Please mention this episode to your doctor." } };
}

export async function clearRedFlag(user: User) {
  const db = await getDb();
  await db.update(s.users).set({ redFlagUntil: null }).where(eq(s.users.id, user.id));
  return { ok: true };
}

export async function giveFeedback(user: User, input: { entityType: string; entityId: string; rating: number; reasonCodes: string[] }) {
  const db = await getDb();
  await db.insert(s.feedback).values({ userId: user.id, ...input });
  if (input.entityType === "recipe") await learn(user, `recipe:${input.entityId}`, input.rating > 0);
  if (input.entityType === "intervention") {
    const { INTERVENTIONS } = await import("../seed/interventions");
    const it = INTERVENTIONS.find((i) => i.slug === input.entityId);
    if (it) await learn(user, `tone:${it.tone}`, input.rating > 0);
  }
  if (input.entityType === "recipe" && input.rating < 0 && input.reasonCodes.length) {
    const rec = await getUserRecipe(user, input.entityId);
    if (rec) await remember(user, `Found ${rec.titleEn} ${input.reasonCodes.join(", ").replace(/_/g, " ")}`, "aversion");
  }
  return { ok: true };
}

export async function setPantry(user: User, key: string, inStock: boolean) {
  const db = await getDb();
  const existing = await db.select().from(s.pantryItems).where(eq(s.pantryItems.userId, user.id));
  if (!existing.length) {
    // First edit: materialise "everything in stock" so toggling one item off doesn't empty the pantry.
    await db.insert(s.pantryItems).values(PANTRY.map((p) => ({ userId: user.id, key: p.key, inStock: true }))).onConflictDoNothing();
  }
  await db.insert(s.pantryItems).values({ userId: user.id, key, inStock }).onConflictDoUpdate({ target: [s.pantryItems.userId, s.pantryItems.key], set: { inStock, updatedAt: new Date() } });
  await logEvent(user, "pantry_updated", { payload: { key, inStock } });
  return { ok: true };
}

export async function getPantry(user: User) {
  const stock = await pantryStock(user);
  return PANTRY.map((p) => ({ ...p, inStock: stock.has(p.key) }));
}
