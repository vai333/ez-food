/**
 * Deterministic next-week planner: used when Gemini is unavailable, and as the safe base the coach edits.
 * Starts from the original Menu A/B week, then adapts it to the user's short-term goals. Pure.
 */
import type { MealSlot, Recipe } from "../types";
import { defaultWeekMenu, slotFitsRecipe, type WeekMenu } from "./plan";
import { validateRecipe } from "../safety/validate";

export type PlannerInput = {
  recipes: Map<string, Recipe>;
  goals: string[];
  /** Favourite recipe slugs, best first (from the bandit). */
  liked: string[];
  disliked: string[];
  /** Max active minutes the user wants per cooked meal. */
  cookMinutes?: number;
};

const usable = (r: Recipe | undefined): r is Recipe => !!r && r.status === "approved" && !r.needsDoctorOk && validateRecipe(r).ok;

export function goalFlags(goals: string[]) {
  const g = goals.join(" ").toLowerCase();
  return {
    quick: /quick|less cooking|busy|time|travel|office/.test(g),
    variety: /variety|bored|different|new|change/.test(g),
    energy: /energy|tired|protein|strength/.test(g),
    digestion: /digest|bloat|gut|light|stomach/.test(g),
  };
}

export function planNextWeek(input: PlannerInput): { menu: WeekMenu; notes: string[] } {
  const menu = defaultWeekMenu();
  const notes: string[] = [];
  const f = goalFlags(input.goals);
  const cookCap = input.cookMinutes ?? (f.quick ? 12 : 45);
  const all = [...input.recipes.values()].filter(usable).filter((r) => !input.disliked.includes(r.slug));
  const pick = (slot: MealSlot, pred: (r: Recipe) => boolean, avoid: string[]) =>
    [...input.liked.map((s) => input.recipes.get(s)).filter(usable), ...all].find((r) => slotFitsRecipe(r, slot) && pred(r) && !avoid.includes(r.slug) && (!r.leadTask || r.leadTask.hours < 2 || r.origin === "plan"));

  const used: string[] = [];
  for (const day of menu.days) {
    for (const s of day.slots) {
      if (s.slot === "wake") continue;
      const current = s.recipes.map((x) => input.recipes.get(x)).filter(usable);
      const tooLong = current.some((r) => r.activeMinutes > cookCap);
      const dislikedHere = s.recipes.some((x) => input.disliked.includes(x));
      let replace = tooLong || dislikedHere;
      // Variety: swap the snack on days 2, 4, 6 and dinner on days 3 and 6 for something new.
      if (f.variety && ((s.slot === "snack" && day.dayNo % 2 === 0) || (s.slot === "dinner" && day.dayNo % 3 === 0))) replace = true;
      if (!replace) continue;
      const alt = pick(
        s.slot,
        (r) =>
          r.activeMinutes <= cookCap &&
          (s.slot !== "dinner" || r.tasteTags.includes("comfort") || r.tasteTags.includes("warm")) &&
          (!f.energy || r.tasteTags.includes("savory") || (r.nutrition?.proteinG ?? 0) >= 8) &&
          (!f.digestion || r.tasteTags.includes("light") || r.tasteTags.includes("warm")),
        [...used, ...s.recipes],
      );
      if (alt) {
        notes.push(`Day ${day.dayNo} ${s.slot}: ${current.map((r) => r.titleEn).join(" + ") || "plan meal"} → ${alt.titleEn}`);
        s.recipes = [alt.slug];
        used.push(alt.slug);
      }
    }
    day.label = day.slots.find((x) => x.slot === "breakfast")?.recipes.some((r) => r === "green-moong-chilla") ? "Chilla day" : day.label;
  }
  return { menu, notes };
}
