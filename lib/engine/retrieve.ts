/**
 * Craving Pivot deterministic retrieval (build prompt §9.6). Filters to safe, time-feasible recipes, then scores by
 * taste overlap, time fit, pantry coverage, learned preference (Thompson sample), recency and novelty.
 * If ≥ 3 strong matches exist, no LLM call is needed.
 */
import type { MealSlot, Recipe, TasteTag } from "../types";
import { PANTRY_ALWAYS } from "../seed/pantry";
import { isShowable } from "../safety/validate";
import { PRIOR, sampleBeta, type Posterior } from "./bandit";

export type CravingQuery = {
  slot: Exclude<MealSlot, "wake">;
  cravings: TasteTag[];
  timeBudgetMin?: number;
  pantry?: Set<string>; // keys in stock; undefined = don't filter
  nowMinutes: number;
  windowStart: number;
  windowEnd: number;
  recentSlugs?: string[]; // eaten in the last 24 h
  excludeSlugs?: string[]; // already rejected this session
  strictCapsicum?: boolean;
  allowDoctorOk?: boolean; // user has said their doctor allows "needsDoctorOk" items
};

export type Scored = { recipe: Recipe; score: number; strong: boolean; reasons: string[]; pantryCoverage: number };

export function pantryCoverage(r: Recipe, pantry?: Set<string>): number {
  if (!pantry) return 1;
  const needed = r.ingredients.filter((i) => !i.optional && i.pantry && !PANTRY_ALWAYS.has(i.pantry));
  if (!needed.length) return 1;
  return needed.filter((i) => pantry.has(i.pantry!)).length / needed.length;
}

export function slotFits(r: Recipe, slot: CravingQuery["slot"]): boolean {
  return r.mealTypes.includes(slot) || r.mealTypes.includes("any") || (slot === "breakfast" && r.mealTypes.includes("dinner")) || (slot === "dinner" && r.mealTypes.includes("breakfast"));
}

export function retrieve(recipes: Recipe[], q: CravingQuery, posteriors: Map<string, Posterior>, r: () => number): Scored[] {
  const inWindow = q.nowMinutes >= q.windowStart - 90 && q.nowMinutes < q.windowEnd; // allow planning ahead ~90 min
  if (!inWindow) return [];
  const budget = q.timeBudgetMin ?? 45;
  const minsLeft = q.windowEnd - Math.max(q.nowMinutes, q.windowStart);
  const out: Scored[] = [];
  for (const rec of recipes) {
    if (rec.mealTypes.length === 1 && rec.mealTypes[0] === "wake") continue;
    if (!isShowable(rec, { strictCapsicum: q.strictCapsicum, allowPendingValid: rec.origin === "ai_generated" })) continue;
    if (rec.needsDoctorOk && !q.allowDoctorOk) continue;
    if (q.excludeSlugs?.includes(rec.slug)) continue;
    if (!slotFits(rec, q.slot) && !rec.quickAssemble) continue;
    const total = rec.activeMinutes + rec.passiveMinutes;
    if (total > minsLeft) continue;
    if (rec.leadTask && rec.leadTask.hours >= 2) continue; // needs a soak we don't have time for
    const cov = pantryCoverage(rec, q.pantry);
    if (q.pantry && cov < 0.6) continue;

    const reasons: string[] = [];
    const overlap = q.cravings.length ? q.cravings.filter((c) => rec.tasteTags.includes(c)).length / q.cravings.length : 0.5;
    if (overlap > 0) reasons.push(q.cravings.filter((c) => rec.tasteTags.includes(c)).join(" + "));
    const timeFit = rec.activeMinutes <= budget ? 1 : Math.max(0, 1 - (rec.activeMinutes - budget) / budget);
    if (rec.activeMinutes <= 10) reasons.push(`ready in ${Math.max(rec.activeMinutes, 2)} min`);
    if (q.pantry && cov === 1) reasons.push("uses what you have");
    const learned = sampleBeta(posteriors.get(`recipe:${rec.slug}`) ?? PRIOR, r);
    const recency = q.recentSlugs?.includes(rec.slug) ? -0.25 : 0;
    const novelty = posteriors.has(`recipe:${rec.slug}`) ? 0 : 0.05;
    const score = overlap * 2 + timeFit * 0.6 + cov * 0.4 + learned * 0.8 + recency + novelty;
    out.push({ recipe: rec, score, strong: overlap >= 0.5 && timeFit >= 0.7 && cov >= 0.8, reasons, pantryCoverage: cov });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** One sentence: "Crunchy + savory, ready in 10 min, uses what you have." */
export function whyThis(s: Scored, cravings: TasteTag[]): string {
  const parts = s.reasons.length ? s.reasons : ["fits your plan"];
  let line = parts.join(", ");
  line = line.charAt(0).toUpperCase() + line.slice(1) + ".";
  if (cravings.includes("spicy")) line += " Heat comes from pepper and ginger, since chillies are on your avoid list.";
  return line;
}
