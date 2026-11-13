/**
 * Prep pipeline (build prompt §9.4.8). Derives soak / sprout tasks from recipe lead times. Pure.
 * - soak ≤ 12 h: 21:00 the evening before (07:30 same morning is the late fallback for a 12:00 meal)
 * - sprout: 21:00 two evenings before, plus a "rinse & drain" the next morning at 08:00
 * - short soaks (< 2 h): meal start − lead − 10 min, same day
 * Plan-start edge: tasks whose due time is already past become "late" with a recovery suggestion.
 */
import type { MealSlot, Recipe } from "../types";
import { addDays, hm } from "../time";
import { slotsForDay, type SlotPlan } from "./plan";

export type PrepTask = {
  key: string; // stable dedupe key: `${mealDate}:${slot}:${recipe}:${kind}`
  dateDue: string;
  timeDue: number; // minutes
  recipeSlug: string;
  mealDate: string;
  slot: MealSlot;
  taskType: "soak" | "sprout" | "rinse" | "prep_ahead";
  instruction: string;
  /** Due time had already passed when generated. */
  late?: boolean;
  recovery?: string;
};

export type PrepInput = {
  /** Original-plan mode: day numbers from this start date. Ignored when slotsFor is given. */
  planStart?: string;
  /** Multi-week mode: the slots planned for a date (null = no plan that day). */
  slotsFor?: (date: string) => SlotPlan[] | null;
  /** Generate tasks for meals on these plan dates. */
  dates: string[];
  recipes: Map<string, Recipe>;
  now: { date: string; minutes: number };
  /** Meal start overrides from the live schedule: `${date}:${slot}` -> minutes. */
  mealStarts?: Map<string, number>;
};

const isPast = (date: string, min: number, now: { date: string; minutes: number }) => date < now.date || (date === now.date && min <= now.minutes);

export function buildPrepTasks(input: PrepInput): PrepTask[] {
  const out: PrepTask[] = [];
  for (const mealDate of input.dates) {
    let daySlots: SlotPlan[] | null;
    if (input.slotsFor) daySlots = input.slotsFor(mealDate);
    else {
      const dayNo = Math.round((Date.parse(`${mealDate}T00:00:00Z`) - Date.parse(`${input.planStart}T00:00:00Z`)) / 86_400_000) + 1;
      daySlots = dayNo < 1 ? null : slotsForDay(dayNo).slots;
    }
    if (!daySlots) continue;
    for (const s of daySlots) {
      const start = input.mealStarts?.get(`${mealDate}:${s.slot}`) ?? s.defaultStart;
      if (isPast(mealDate, start, input.now)) continue; // nothing to prepare for a meal that has started
      for (const slug of s.recipeSlugs) {
        const r = input.recipes.get(slug);
        const lead = r?.leadTask;
        if (!r || !lead) continue;
        const base = { recipeSlug: slug, mealDate, slot: s.slot };
        if (lead.type === "sprout") {
          const soakDate = addDays(mealDate, -2);
          const t: PrepTask = { ...base, key: `${mealDate}:${s.slot}:${slug}:sprout`, dateDue: soakDate, timeDue: hm("21:00"), taskType: "sprout", instruction: lead.instruction };
          if (isPast(t.dateDue, t.timeDue, input.now)) {
            // Plan started late: soak now. Sprouts need roughly a day; note the shorter time honestly.
            t.late = true;
            t.dateDue = input.now.date;
            t.timeDue = input.now.minutes;
            t.recovery = "Soak now in warm water. If the sprouts are only just tailing by break-fast, steam them a little longer.";
          }
          out.push(t);
          // Rinse & drain ~10 h after the soak; never between 23:00 and 07:00 (moved to 07:30).
          let rDate = t.dateDue;
          let rMin = t.timeDue + 10 * 60;
          if (rMin >= 1440) { rDate = addDays(rDate, 1); rMin -= 1440; }
          if (rMin >= hm("23:00")) { rDate = addDays(rDate, 1); rMin = hm("07:30"); } else if (rMin < hm("07:00")) rMin = hm("07:30");
          if (rDate < mealDate || (rDate === mealDate && rMin < start)) {
            out.push({ ...base, key: `${mealDate}:${s.slot}:${slug}:rinse`, dateDue: rDate, timeDue: rMin, taskType: "rinse", instruction: "Drain and rinse the soaked moong, then leave it covered in a warm spot to sprout." });
          }
          continue;
        }
        if (lead.hours < 2) {
          const t: PrepTask = { ...base, key: `${mealDate}:${s.slot}:${slug}:${lead.type}`, dateDue: mealDate, timeDue: start - Math.round(lead.hours * 60) - 10 - r.activeMinutes, taskType: lead.type === "prep_ahead" ? "prep_ahead" : "soak", instruction: lead.instruction };
          if (isPast(t.dateDue, t.timeDue, input.now) && !isPast(mealDate, start, input.now)) {
            t.late = true;
            t.recovery = "Start the soak now; a shorter soak just means a slightly longer cook.";
          }
          out.push(t);
          continue;
        }
        // Overnight soak
        const t: PrepTask = { ...base, key: `${mealDate}:${s.slot}:${slug}:soak`, dateDue: addDays(mealDate, -1), timeDue: hm("21:00"), taskType: "soak", instruction: lead.instruction };
        if (isPast(t.dateDue, t.timeDue, input.now)) {
          const latestStart = start - Math.round(lead.hours * 60) - r.activeMinutes;
          if (input.now.date === mealDate && input.now.minutes <= Math.max(latestStart, hm("07:30"))) {
            // 07:30 same morning is an acceptable soak (hot water, 4 h).
            t.dateDue = mealDate;
            t.timeDue = Math.max(input.now.minutes, Math.min(hm("07:30"), latestStart));
            t.instruction = `${lead.instruction} Use hot water today so it's ready in time.`;
          } else if (input.now.date === mealDate || input.now.date === addDays(mealDate, -1)) {
            t.late = true;
            t.dateDue = input.now.date;
            t.timeDue = input.now.minutes;
            t.recovery = input.now.date === mealDate
              ? "Too late for a full soak before this meal. Soak in hot water now and eat a little later, or swap to a no-soak option (logged as an adapted meal, not a miss)."
              : "Soak now; it will be ready by tomorrow.";
          } else {
            continue; // meal is in the past; nothing to do
          }
        }
        out.push(t);
      }
    }
  }
  // Dedupe walnuts soaked for the same snack etc. by key, keep earliest.
  const seen = new Map<string, PrepTask>();
  for (const t of out) if (!seen.has(t.key)) seen.set(t.key, t);
  return [...seen.values()].sort((a, b) => (a.dateDue === b.dateDue ? a.timeDue - b.timeDue : a.dateDue < b.dateDue ? -1 : 1));
}
