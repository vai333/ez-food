/** Plan engine: which plan week covers a date, which day of it, and what each slot serves. Pure. */
import { PLAN } from "../seed/plan";
import type { MealSlot, Recipe } from "../types";
import { addDays, daysBetween, hm } from "../time";
import { validateRecipe } from "../safety/validate";
import { MAX_ADDED_FAT_TSP_PER_MEAL } from "../safety/ontology";

export function planDayNo(startDate: string, date: string): number {
  return daysBetween(startDate, date) + 1;
}

export function isPlanDay(startDate: string, date: string): boolean {
  const d = planDayNo(startDate, date);
  return d >= 1 && d <= PLAN.lengthDays;
}

export type SlotPlan = { slot: MealSlot; defaultStart: number; recipeSlugs: string[] };

/** A confirmed week: 7 days × 4 slots. Stored on user_plans.menu. */
export type WeekMenu = { days: { dayNo: number; label?: string; slots: { slot: MealSlot; time: string; recipes: string[] }[] }[] };

export function defaultWeekMenu(): WeekMenu {
  return {
    days: Array.from({ length: PLAN.lengthDays }, (_, i) => {
      const menu = PLAN.menuFor(i + 1);
      return { dayNo: i + 1, label: `Menu ${menu}`, slots: PLAN.slots.map((s) => ({ slot: s.slot, time: s.time, recipes: [...s[menu]] })) };
    }),
  };
}

/** Day N's menu. After day 7 the plan keeps alternating (the app supports "repeat the week"). */
export function slotsForDay(dayNo: number): { menu: "A" | "B"; slots: SlotPlan[] } {
  const menu = PLAN.menuFor(Math.max(1, dayNo));
  return {
    menu,
    slots: PLAN.slots.map((s) => ({ slot: s.slot, defaultStart: hm(s.time), recipeSlugs: [...s[menu]] })),
  };
}

/** Slots for a day of a given week (null menu = original plan). Days beyond the week repeat it. */
export function slotsForPlanDay(menu: WeekMenu | null, dayNo: number): { label: string; slots: SlotPlan[] } {
  if (!menu) {
    const d = slotsForDay(dayNo);
    return { label: `Menu ${d.menu}`, slots: d.slots };
  }
  const len = menu.days.length;
  const idx = (((Math.max(1, dayNo) - 1) % len) + len) % len;
  const day = menu.days[idx];
  return { label: day.label ?? `Day ${day.dayNo}`, slots: day.slots.map((s) => ({ slot: s.slot, defaultStart: hm(s.time), recipeSlugs: s.recipes })) };
}

export type PlanRow = { id?: string; startDate: string; weekNo: number; lengthDays: number; menu: WeekMenu | null };

/** The plan week covering `date`: the latest week that has started. Before the first week starts → null. */
export function planForDate<P extends PlanRow>(plans: P[], date: string): { plan: P; dayNo: number; beyondEnd: boolean } | null {
  const started = plans.filter((p) => p.startDate <= date).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const plan = started[0];
  if (!plan) return null;
  const dayNo = planDayNo(plan.startDate, date);
  return { plan, dayNo, beyondEnd: dayNo > plan.lengthDays };
}

export function slotsForDate(plans: PlanRow[], date: string): SlotPlan[] | null {
  const p = planForDate(plans, date);
  return p ? slotsForPlanDay(p.plan.menu, p.dayNo).slots : null;
}

export function planEnd(p: PlanRow): string {
  return addDays(p.startDate, p.lengthDays - 1);
}

/** Plan start default: today, or tomorrow if it's already past the window close (20:00). */
export function defaultStartDate(todayIst: string, nowMinutes: number): string {
  return nowMinutes >= hm("20:00") ? addDays(todayIst, 1) : todayIst;
}

const SLOT_ORDER: MealSlot[] = ["wake", "breakfast", "snack", "dinner"];

export function slotFitsRecipe(r: Recipe, slot: MealSlot): boolean {
  if (slot === "wake") return r.mealTypes.length === 1 && r.mealTypes[0] === "wake";
  if (r.mealTypes.includes("wake") && r.mealTypes.length === 1) return false;
  return r.mealTypes.includes(slot) || r.mealTypes.includes("any") || !!r.quickAssemble || (slot === "breakfast" && r.mealTypes.includes("dinner")) || (slot === "dinner" && r.mealTypes.includes("breakfast"));
}

export type WeekCheck = { ok: boolean; errors: string[]; repaired: WeekMenu; repairs: string[] };

/**
 * Deterministic gate for any proposed week (coach or fallback planner). Repairs what it safely can by falling back
 * to the original plan's item for that day/slot, and reports every repair. Code has the final say.
 */
export function checkWeekMenu(menu: WeekMenu, recipes: Map<string, Recipe>, window: { start: number; end: number }, opts: { strictCapsicum?: boolean } = {}): WeekCheck {
  const errors: string[] = [];
  const repairs: string[] = [];
  const base = defaultWeekMenu();
  const days = Array.from({ length: 7 }, (_, i) => menu.days.find((d) => d.dayNo === i + 1) ?? null);
  const out: WeekMenu = { days: [] };
  days.forEach((d, i) => {
    const dayNo = i + 1;
    const fallback = base.days[i];
    if (!d) {
      repairs.push(`Day ${dayNo} was missing; used the original plan's day.`);
      out.days.push(fallback);
      return;
    }
    const slots: WeekMenu["days"][number]["slots"] = [];
    for (const slot of SLOT_ORDER) {
      const fb = fallback.slots.find((s) => s.slot === slot)!;
      const got = d.slots.find((s) => s.slot === slot);
      let recs = (got?.recipes ?? []).filter((slug) => {
        const r = recipes.get(slug);
        if (!r) { repairs.push(`Day ${dayNo} ${slot}: "${slug}" isn't a known recipe; removed.`); return false; }
        if (r.status !== "approved" || r.needsDoctorOk || !validateRecipe(r, opts).ok) { repairs.push(`Day ${dayNo} ${slot}: ${r.titleEn} needs review first; removed.`); return false; }
        if (!slotFitsRecipe(r, slot)) { repairs.push(`Day ${dayNo} ${slot}: ${r.titleEn} doesn't fit this slot; removed.`); return false; }
        return true;
      });
      const fat = recs.reduce((a, slug) => a + (recipes.get(slug)?.addedFatTsp ?? 0), 0);
      if (fat > MAX_ADDED_FAT_TSP_PER_MEAL) { repairs.push(`Day ${dayNo} ${slot}: over 1 tsp fat in total; used the original meal.`); recs = []; }
      if (!recs.length) { recs = fb.recipes; if (got?.recipes?.length) { /* reported above */ } else repairs.push(`Day ${dayNo} ${slot}: empty; used the original meal.`); }
      let time = got?.time && /^\d{2}:\d{2}$/.test(got.time) ? got.time : fb.time;
      const t = hm(time);
      if (slot !== "wake" && (t < window.start || t + 25 > window.end)) { repairs.push(`Day ${dayNo} ${slot}: ${time} is outside your eating window; reset to ${fb.time}.`); time = fb.time; }
      if (slot === "wake" && (t < hm("05:00") || t > hm("09:00"))) time = fb.time;
      slots.push({ slot, time, recipes: recs });
    }
    // Gap rules between food slots: 150–300 min; otherwise use the default times for the day.
    const food = slots.filter((s) => s.slot !== "wake").map((s) => hm(s.time));
    const gapsOk = food.every((t, k) => k === 0 || (t - food[k - 1] >= 150 && t - food[k - 1] <= 300));
    if (!gapsOk) {
      repairs.push(`Day ${dayNo}: meal gaps must be 2.5–5 h; used the standard times.`);
      for (const s of slots) s.time = fallback.slots.find((f) => f.slot === s.slot)!.time;
    }
    out.days.push({ dayNo, label: d.label?.slice(0, 40), slots });
  });
  if (menu.days.length !== 7) errors.push(`Expected 7 days, got ${menu.days.length}.`);
  return { ok: repairs.length === 0 && errors.length === 0, errors, repaired: out, repairs };
}
