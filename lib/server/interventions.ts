/** Behaviour engine: choose one approved message by context, with a Thompson-sampled tone (build prompt §9.7). */
import "server-only";
import { INTERVENTIONS } from "../seed/interventions";
import type { DeviationType, Intervention, MealSlot, Tone } from "../types";
import { rng, sampleBeta, PRIOR } from "../engine/bandit";
import { hash32 } from "../game/engine";
import { posteriors } from "./learning";
import { timeOfDay } from "../time";

export type PickCtx = { deviation?: DeviationType; slot?: MealSlot; minutes: number; positive?: boolean; seed: string; exclude?: string[] };

function matches(i: Intervention, c: PickCtx): number {
  const t = i.triggers ?? {};
  if (c.positive) return t.positive ? 2 : -1;
  if (t.positive) return -1;
  let score = 0;
  if (t.deviation?.length) score += c.deviation && t.deviation.includes(c.deviation) ? 2 : -1;
  if (t.slot?.length) score += c.slot && t.slot.includes(c.slot) ? 1 : -0.5;
  if (t.timeOfDay?.length) score += t.timeOfDay.includes(timeOfDay(c.minutes)) ? 0.5 : -0.5;
  return score;
}

export async function pickIntervention(userId: string, c: PickCtx): Promise<Intervention> {
  const post = await posteriors(userId, "tone:");
  const r = rng(hash32(c.seed));
  const toneScore = new Map<Tone, number>((["warm", "calm", "playful", "firm"] as Tone[]).map((t) => [t, sampleBeta(post.get(`tone:${t}`) ?? PRIOR, r) * (t === "firm" ? 0.8 : 1)]));
  const pool = INTERVENTIONS.filter((i) => !c.exclude?.includes(i.slug) && i.type !== "breathing" || (c.deviation === "off_plan_item" && i.type === "breathing"));
  const scored = pool.map((i) => ({ i, s: matches(i, c) + (toneScore.get(i.tone) ?? 0.5) + r() * 0.3 })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return (scored[0] ?? { i: INTERVENTIONS[0] }).i;
}

export function breathingItems() {
  return INTERVENTIONS.filter((i) => i.type === "breathing");
}
