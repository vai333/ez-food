/**
 * Deterministic validator: the FINAL gate for every recipe shown to the user (build prompt §11.3).
 * LLM output, curated seeds and swaps all pass through here. Code has the final say.
 */
import { BANNED, MAX_ADDED_FAT_TSP_PER_MEAL, SAFE_PHRASES, type BanRule } from "./ontology";
import type { Recipe } from "../types";

export type Violation = {
  rule: BanRule | "fat_cap" | "structure" | "window" | "status";
  ingredient?: string;
  matchedAlias?: string;
  humanMessage: string;
};

export type ValidationResult = { ok: boolean; violations: Violation[] };

export type ValidateOptions = { strictCapsicum?: boolean; maxFatTsp?: number };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pre-compiled alias matchers, longest alias first so "tomato puree" wins over "tomato". */
const MATCHERS = BANNED.flatMap((b) =>
  b.aliases.map((a) => ({ entry: b, alias: a, re: new RegExp(`(^|[^a-z])${esc(a.toLowerCase())}(?=$|[^a-z])`, "i") })),
).sort((x, y) => y.alias.length - x.alias.length);

const SAFE_RE = SAFE_PHRASES.map((p) => new RegExp(esc(p.toLowerCase()), "gi"));

/** Normalise free text: lowercase, unify dashes/quotes, strip known-safe phrases. */
export function normaliseText(text: string): string {
  let t = text.toLowerCase().replace(/[‐-―]/g, "-").replace(/[‘’]/g, "'");
  for (const re of SAFE_RE) t = t.replace(re, " ");
  // Negations name a banned item without using it: "no tomatoes", "without red chillies". Strip ONE item word
  // (plus an optional colour/size qualifier) so "no tomato potato curry" still fails on potato.
  t = t.replace(/\b(?:no|without|avoid|zero|skip)\s+(?:(?:red|green|added|fresh|any)\s+)?[a-z']+/g, " ");
  return t;
}

/** Scan any text for banned aliases. Returns one violation per banned entry found. */
export function scanText(text: string, opts: ValidateOptions = {}): Violation[] {
  const strict = opts.strictCapsicum ?? true;
  const t = normaliseText(text);
  const found = new Map<string, Violation>();
  for (const m of MATCHERS) {
    if (m.entry.strictOnly && !strict) continue;
    if (found.has(m.entry.canonical)) continue;
    if (m.re.test(t)) {
      found.set(m.entry.canonical, { rule: m.entry.rule, ingredient: m.entry.canonical, matchedAlias: m.alias, humanMessage: m.entry.reason });
    }
  }
  return [...found.values()];
}

/** Validate a full recipe. `ok` is true only with zero violations. */
export function validateRecipe(r: Recipe, opts: ValidateOptions = {}): ValidationResult {
  const violations: Violation[] = [];
  const cap = opts.maxFatTsp ?? MAX_ADDED_FAT_TSP_PER_MEAL;

  // Structure
  if (!r.ingredients?.length) violations.push({ rule: "structure", humanMessage: "Recipe has no ingredients." });
  if (!r.steps?.length) violations.push({ rule: "structure", humanMessage: "Recipe has no steps." });
  for (const s of r.steps ?? []) {
    if (s.durationSeconds !== undefined && (!Number.isFinite(s.durationSeconds) || s.durationSeconds <= 0 || s.durationSeconds > 6 * 3600)) {
      violations.push({ rule: "structure", humanMessage: `Step has an invalid timer: "${s.text.slice(0, 40)}".` });
    }
  }
  if (!Number.isFinite(r.activeMinutes) || r.activeMinutes < 0) violations.push({ rule: "structure", humanMessage: "Active time is missing." });

  // Fat cap
  if (!(r.addedFatTsp >= 0) || r.addedFatTsp > cap) {
    violations.push({ rule: "fat_cap", humanMessage: `Uses ${r.addedFatTsp} tsp added fat; the cap is ${cap} tsp per meal.` });
  }

  // Banned aliases anywhere: names, notes, steps, tips, title, description
  const corpus = [
    r.titleEn,
    r.description,
    ...r.ingredients.map((i) => `${i.name} ${i.note ?? ""}`),
    ...r.steps.map((s) => `${s.text} ${s.tip ?? ""}`),
  ].join(" \n ");
  violations.push(...scanText(corpus, opts));

  // Wake / fasting slot may only hold fasting-safe drinks
  if (r.mealTypes.length === 1 && r.mealTypes[0] === "wake" && r.ingredients.some((i) => /fruit|nut|dal|curd|milk|date/i.test(i.name))) {
    violations.push({ rule: "window", humanMessage: "Only water, green tea, black coffee or ginger-turmeric water before 12:00." });
  }

  return { ok: violations.length === 0, violations };
}

/** Recipes the UI may show: approved and valid. Pending-review AI recipes are allowed only if `allowPendingValid`. */
export function isShowable(r: Recipe, opts: ValidateOptions & { allowPendingValid?: boolean } = {}): boolean {
  if (r.status === "rejected") return false;
  if (r.status === "pending_review" && !opts.allowPendingValid) return false;
  return validateRecipe(r, opts).ok;
}
