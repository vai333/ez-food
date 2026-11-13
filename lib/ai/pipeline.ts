/**
 * Council-in-the-loop generation (build prompt §2.3 / §11): Generator → Council → deterministic validator.
 * Only candidates that clear all three are returned. Code has the final say.
 */
import "server-only";
import { z } from "zod";
import crypto from "node:crypto";
import type { MealSlot, Recipe, TasteTag } from "../types";
import { validateRecipe } from "../safety/validate";
import { llmJson } from "./gemini";
import { CouncilOutput, GenOutput, GenRecipe, councilSystem, generatorPrompt, generatorSystem, renderConstraints, BANNED_COPY, type GenRecipeT } from "./prompts";

export type GenContext = {
  userId: string;
  profileVersion: number;
  slot: Exclude<MealSlot, "wake">;
  cravings: TasteTag[];
  pantry: string[];
  timeBudget: number;
  strictCapsicum: boolean;
  windowStart: string;
  windowEnd: string;
  preferenceSummary: string;
  accepted: string[];
  rejected: string[];
  note?: string;
};

export type PipelineResult = { recipes: (Recipe & { whyThis: string })[]; rawCandidates: number; councilRejected: number; validatorRejected: number; error?: string };

export function toRecipe(g: GenRecipeT, slot: GenContext["slot"]): Recipe & { whyThis: string } {
  const why = g.whyThis?.trim() || g.description.split(/(?<=\.)\s/)[0] || "Fits your plan and your craving.";
  const slug = `ai-${g.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${crypto.createHash("sha1").update(JSON.stringify(g)).digest("hex").slice(0, 6)}`;
  return {
    slug,
    titleEn: g.title,
    description: g.description,
    mealTypes: [slot],
    cuisine: "Indian home",
    tasteTags: g.tasteTags,
    textureTags: [],
    temperature: g.tasteTags.includes("cool") ? "cool" : "warm",
    activeMinutes: g.activeMinutes,
    passiveMinutes: g.passiveMinutes,
    difficulty: g.activeMinutes > 25 ? 2 : 1,
    servings: 1,
    addedFatTsp: g.addedFatTsp,
    ingredients: g.ingredients.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })),
    steps: g.steps.map((s) => ({ text: s.text, durationSeconds: s.durationSeconds, timerLabel: s.timerLabel })),
    whyGood: why,
    whyThis: why,
    origin: "ai_generated",
    status: "pending_review",
    source: "estimate",
    art: "bowl",
  };
}

export async function generateAlternatives(ctx: GenContext, n = 3): Promise<PipelineResult> {
  const constraints = renderConstraints(ctx.strictCapsicum, ctx.windowStart, ctx.windowEnd);
  const gen = await llmJson({
    purpose: "recipe_generate",
    userId: ctx.userId,
    system: generatorSystem(constraints),
    prompt: generatorPrompt({ ...ctx, n }),
    schema: GenOutput,
    temperature: 0.7,
    cacheKeyExtra: `pv${ctx.profileVersion}`,
    maxOutputTokens: 6000,
    schemaHint: z.object({ candidates: z.array(GenRecipe) }),
  });
  if (!gen.ok) return { recipes: [], rawCandidates: 0, councilRejected: 0, validatorRejected: 0, error: gen.error };
  const cands = gen.data.candidates.map((c) => GenRecipe.safeParse(c)).filter((p) => p.success).map((p) => p.data!);
  if (!cands.length) return { recipes: [], rawCandidates: gen.data.candidates.length, councilRejected: 0, validatorRejected: 0, error: "no well-formed candidates" };

  const council = await llmJson({
    purpose: "recipe_council",
    userId: ctx.userId,
    system: councilSystem(constraints),
    prompt: `<candidates>${JSON.stringify(cands.map((c, index) => ({ index, ...c })))}</candidates>`,
    schema: CouncilOutput,
    temperature: 0.1,
    model: "reasoning",
    maxOutputTokens: 3000,
  });
  // No council verdict = fail closed.
  const approved = new Set(council.ok ? council.data.verdicts.filter((v) => v.approved && v.violations.length === 0).map((v) => v.index) : []);
  let councilRejected = 0, validatorRejected = 0;
  const out: PipelineResult["recipes"] = [];
  cands.forEach((c, i) => {
    if (!approved.has(i)) { councilRejected++; return; }
    const r = toRecipe(c, ctx.slot);
    const v = validateRecipe(r, { strictCapsicum: ctx.strictCapsicum });
    if (!v.ok || BANNED_COPY.test(`${r.description} ${r.whyThis}`)) { validatorRejected++; return; }
    out.push(r);
  });
  return { recipes: out, rawCandidates: cands.length, councilRejected, validatorRejected, error: council.ok ? undefined : `council: ${council.error}` };
}
