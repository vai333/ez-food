/**
 * Units + portions. Pure.
 * - Unit preference: show solids in g / mg / kg / oz and liquids in ml / l instead of cups, spoons, glasses, inches…
 * - Calorie target: scale FOOD quantities by a factor. Added fat (ghee / oils) is never scaled up: the ≤ 1 tsp cap holds.
 *   Spices, salt and "to taste" amounts stay as they are.
 * Applies to structured ingredients AND to quantities written inside text (prep tasks, steps, descriptions).
 * Densities are kitchen estimates (source: estimate, listed in docs/REVIEW_QUEUE.md).
 */
import type { Recipe, RecipeIngredient } from "../types";

export type SolidUnit = "original" | "g" | "mg" | "kg" | "oz";
export type LiquidUnit = "original" | "ml" | "l" | "cup" | "fl oz";
export type UnitPref = { solid: SolidUnit; liquid: LiquidUnit; spoons: "keep" | "metric" };
export const DEFAULT_UNITS: UnitPref = { solid: "original", liquid: "original", spoons: "keep" };

export type PortionOpts = { units?: UnitPref; factor?: number; /** scale cooking water with the food (false for drinks) */ scaleWater?: boolean };

type Density = {
  re: RegExp;
  /** grams per cup (solids) */
  cup?: number;
  tbsp?: number;
  tsp?: number;
  /** grams per piece, by the size word used ("medium", "inch", "halves"…); "each" = bare count */
  piece?: Record<string, number>;
  liquid?: boolean;
  /** scaled by a calorie factor? (false for fats, spices, water) */
  food: boolean;
  fat?: boolean;
};

const ML_PER_CUP = 240;
const ML_PER_GLASS = 250;
const ML_PER_TBSP = 15;
const ML_PER_TSP = 5;

/** First match wins: put specific items before generic ones. */
export const DENSITIES: Density[] = [
  // fats: never scaled
  { re: /\bghee\b/i, tsp: 5, tbsp: 15, food: false, fat: true },
  { re: /\b(mustard|coconut|cold-pressed)?\s*oil\b/i, tsp: 4.5, tbsp: 13.5, food: false, fat: true },
  // liquids
  { re: /\b(water|green tea|black coffee|coconut water)\b/i, liquid: true, food: false },
  { re: /\bbuttermilk|chaas\b/i, liquid: true, food: true },
  // pulses & grains (dry unless stated)
  { re: /\bsprout(ed|s)?\b/i, cup: 105, food: true },
  { re: /\bwhole green moong|green moong|moong beans?\b/i, cup: 200, tbsp: 12, food: true },
  { re: /\byellow moong|moong dal|split moong\b/i, cup: 205, tbsp: 13, food: true },
  { re: /\bmasoor\b/i, cup: 190, tbsp: 12, food: true },
  { re: /\b(tur|toor|arhar)\b/i, cup: 200, tbsp: 12, food: true },
  { re: /\broasted chana|roasted gram|bhuna chana\b/i, cup: 140, tbsp: 9, food: true },
  { re: /\b(kabuli|kala|black)?\s*chana|chickpeas?\b/i, cup: 190, tbsp: 12, food: true },
  { re: /\bbrown rice|rice\b/i, cup: 185, tbsp: 12, food: true },
  { re: /\bjowar|sorghum\b/i, cup: 120, tbsp: 8, food: true },
  { re: /\boats\b/i, cup: 90, tbsp: 6, food: true },
  { re: /\bpoha\b/i, cup: 100, tbsp: 6, food: true },
  { re: /\bmurmura|puffed rice\b/i, cup: 15, food: true },
  { re: /\bmakhana|fox ?nuts?\b/i, cup: 15, food: true },
  // dairy
  { re: /\bcurd|dahi|yogh?urt\b/i, cup: 245, tbsp: 15, food: true },
  // fruit
  { re: /\bpapaya\b/i, cup: 145, food: true },
  { re: /\bpomegranate\b/i, cup: 175, piece: { each: 280, medium: 280 }, food: true },
  { re: /\bapple\b/i, cup: 125, piece: { each: 180, medium: 180, small: 150 }, food: true },
  { re: /\bpear\b/i, cup: 140, piece: { each: 180, medium: 180 }, food: true },
  { re: /\bguava\b/i, piece: { each: 100, medium: 100 }, food: true },
  { re: /\bbanana\b/i, piece: { each: 120, medium: 120 }, food: true },
  { re: /\bdates?\b/i, piece: { each: 7 }, food: true },
  // nuts & seeds
  { re: /\bwalnuts?\b/i, cup: 100, piece: { each: 4.5, halves: 2, half: 2 }, food: true },
  { re: /\balmonds?\b/i, cup: 143, piece: { each: 1.2 }, food: true },
  { re: /\b(flax|pumpkin|sunflower|chia)\s*(seeds?)?\b/i, cup: 150, tbsp: 10, tsp: 3.5, food: true },
  // vegetables
  { re: /\bcucumber\b/i, cup: 120, piece: { each: 200, medium: 200, small: 150, large: 300 }, food: true },
  { re: /\bcarrot\b/i, cup: 110, piece: { each: 60, small: 50, medium: 70, large: 90 }, food: true },
  { re: /\blauki|bottle gourd\b/i, cup: 120, piece: { each: 700, medium: 700, small: 450 }, food: true },
  { re: /\bspinach|palak\b/i, cup: 30, piece: { bunch: 250 }, food: true },
  { re: /\bpumpkin|kaddu\b/i, cup: 116, food: true },
  { re: /\bcabbage\b/i, cup: 70, food: true },
  { re: /\bbeans\b/i, cup: 110, food: true },
  { re: /\bsweet potato|shakarkandi\b/i, cup: 135, piece: { each: 150, medium: 150 }, food: true },
  { re: /\bonion\b/i, cup: 160, piece: { each: 110, medium: 110, small: 70 }, food: true },
  { re: /\bbeetroot\b/i, cup: 135, piece: { each: 120, medium: 120 }, food: true },
  { re: /\bginger\b/i, piece: { inch: 6 }, tsp: 2, food: false },
  // herbs & spices (never scaled)
  { re: /\bcoriander|mint|curry leaves\b/i, cup: 16, tbsp: 1, food: false },
  { re: /\bcumin|jeera\b/i, tsp: 2, tbsp: 6, food: false },
  { re: /\bturmeric|haldi\b/i, tsp: 3, food: false },
  { re: /\bblack pepper|pepper\b/i, tsp: 2.5, food: false },
  { re: /\bmustard seeds?|rai\b/i, tsp: 3.5, food: false },
  { re: /\bajwain|carom\b/i, tsp: 2, food: false },
  { re: /\bamchur|chaat spice\b/i, tsp: 2, food: false },
  { re: /\bcinnamon|cardamom\b/i, tsp: 2.6, food: false },
  { re: /\bhing|asafoetida\b/i, tsp: 1, food: false },
  { re: /\bsalt|kala namak\b/i, tsp: 6, food: false },
];

export function densityFor(name: string): Density | null {
  return DENSITIES.find((d) => d.re.test(name)) ?? null;
}

// ---------------------------------------------------------------- unit vocabulary
const UNIT_ALIASES: [RegExp, string][] = [
  [/^cups?(\s*\(raw\))?$/i, "cup"],
  [/^(tbsp|tablespoons?)$/i, "tbsp"],
  [/^(tsp|teaspoons?)$/i, "tsp"],
  [/^glass(es)?$/i, "glass"],
  [/^inch(es)?$/i, "inch"],
  [/^(ml|millilit(re|er)s?)$/i, "ml"],
  [/^(g|grams?|gm)$/i, "g"],
  [/^(medium|small|large|bunch|halves|half)$/i, "$piece"],
];

export function canonicalUnit(u?: string): string | undefined {
  if (!u) return undefined;
  const t = u.trim();
  for (const [re, c] of UNIT_ALIASES) if (re.test(t)) return c === "$piece" ? t.toLowerCase() : c;
  return t.toLowerCase();
}

/** Quantity of an ingredient in grams (solids) or ml (liquids), when we can estimate it. */
export function toBase(qty: number, unit: string | undefined, name: string): { amount: number; kind: "g" | "ml" } | null {
  const u = canonicalUnit(unit);
  const d = densityFor(name);
  if (u === "g") return { amount: qty, kind: "g" };
  if (u === "ml") return { amount: qty, kind: "ml" };
  if (d?.liquid) {
    if (u === "cup") return { amount: qty * ML_PER_CUP, kind: "ml" };
    if (u === "glass") return { amount: qty * ML_PER_GLASS, kind: "ml" };
    if (u === "tbsp") return { amount: qty * ML_PER_TBSP, kind: "ml" };
    if (u === "tsp") return { amount: qty * ML_PER_TSP, kind: "ml" };
    return null;
  }
  if (!d) return null;
  if (u === "cup" && d.cup) return { amount: qty * d.cup, kind: "g" };
  if (u === "tbsp" && (d.tbsp ?? (d.tsp ? d.tsp * 3 : undefined))) return { amount: qty * (d.tbsp ?? d.tsp! * 3), kind: "g" };
  if (u === "tsp" && (d.tsp ?? (d.tbsp ? d.tbsp / 3 : undefined))) return { amount: qty * (d.tsp ?? d.tbsp! / 3), kind: "g" };
  if (u && d.piece?.[u]) return { amount: qty * d.piece[u], kind: "g" };
  if (!u && d.piece?.each) return { amount: qty * d.piece.each, kind: "g" };
  return null;
}

const nice = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

export function formatAmount(amount: number, kind: "g" | "ml", pref: UnitPref): { qty: number; unit: string } {
  if (kind === "ml") {
    switch (pref.liquid) {
      case "l": return { qty: Math.round((amount / 1000) * 100) / 100, unit: "l" };
      case "cup": return { qty: Math.round((amount / ML_PER_CUP) * 4) / 4, unit: "cup" };
      case "fl oz": return { qty: Math.round((amount / 29.57) * 10) / 10, unit: "fl oz" };
      default: return { qty: amount < 20 ? Math.round(amount) : nice(amount, 5), unit: "ml" };
    }
  }
  switch (pref.solid) {
    case "mg": return { qty: nice(amount * 1000, amount < 1 ? 10 : 100), unit: "mg" };
    case "kg": return { qty: Math.round((amount / 1000) * 1000) / 1000, unit: "kg" };
    case "oz": return { qty: Math.round((amount / 28.35) * 10) / 10, unit: "oz" };
    default: return { qty: amount < 10 ? Math.round(amount * 2) / 2 : nice(amount, 5), unit: "g" };
  }
}

const isSpoon = (u?: string) => u === "tsp" || u === "tbsp";

/** Should this unit be converted under the preference? */
function wantsConversion(u: string | undefined, liquid: boolean, pref: UnitPref): boolean {
  if (isSpoon(u)) return pref.spoons === "metric";
  if (liquid || u === "ml") return pref.liquid !== "original" && !(u === "ml" && pref.liquid === "ml");
  return pref.solid !== "original" && !(u === "g" && pref.solid === "g");
}

// ---------------------------------------------------------------- structured ingredients
export function portionIngredient(ing: RecipeIngredient, opts: PortionOpts): RecipeIngredient {
  const pref = opts.units ?? DEFAULT_UNITS;
  const factor = opts.factor ?? 1;
  if (ing.qty === undefined) return ing;
  const d = densityFor(ing.name);
  const isWater = !!d?.liquid && !d.food;
  const scale = factor !== 1 && (d?.food || (isWater && opts.scaleWater)) ? factor : 1;
  let qty = ing.qty * scale;
  const unit = ing.unit;
  const u = canonicalUnit(unit);
  const pieceLike = !u || u === "inch" || !!d?.piece?.[u ?? ""];
  if (pieceLike && !(u && ["cup", "tbsp", "tsp", "glass", "g", "ml"].includes(u))) {
    // Counts and pieces stay human ("4 walnuts", "1 medium cucumber"); add a weight hint when the user wants weights.
    if (scale !== 1) qty = Math.max(1, Math.round(qty * (u === "inch" ? 2 : 1)) / (u === "inch" ? 2 : 1));
    const base = pref.solid !== "original" ? toBase(qty, unit, ing.name) : null;
    const hint = base ? `≈ ${formatAmount(base.amount, base.kind, pref).qty} ${formatAmount(base.amount, base.kind, pref).unit}` : null;
    return { ...ing, qty, unit, note: hint ? [ing.note, hint].filter(Boolean).join(", ") : ing.note };
  }
  if (wantsConversion(u, !!d?.liquid, pref)) {
    const base = toBase(qty, unit, ing.name);
    if (base) {
      const f = formatAmount(base.amount, base.kind, pref);
      return { ...ing, qty: f.qty, unit: f.unit, note: ing.note };
    }
  }
  // Already metric (g / ml / mg …): keep the unit, round sensibly.
  if (scale !== 1 && (u === "g" || u === "ml")) {
    const f = formatAmount(qty, u, { solid: "g", liquid: "ml", spoons: "keep" });
    return { ...ing, qty: f.qty, unit };
  }
  // Counts (walnuts, rotis) scale to whole numbers; everything else to quarters.
  if (scale !== 1) qty = !u || u === "halves" ? Math.max(1, Math.round(qty)) : Math.round(qty * 4) / 4;
  return { ...ing, qty, unit };
}

// ---------------------------------------------------------------- quantities inside text
const FRAC: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
const NUM = String.raw`(\d+(?:\.\d+)?(?:\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔]|\d+\/\d+)`;
const UNIT = String.raw`(cups?(?:\s*\(raw\))?|tbsp|tablespoons?|tsp|teaspoons?|glass(?:es)?|inch(?:es)?|ml|g|grams?|medium|small|large|bunch|halves)?`;
const TEXT_QTY = new RegExp(String.raw`(?<![\w.])${NUM}\s*${UNIT}(?=\s|$)((?:\s+[A-Za-z\-()']+){1,5})?`, "g");
const NOT_FOOD_AFTER = /^\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?|whistles?|days?|times?|step|of\s+the|to\s+\d|-?\s*\d)/i;

export function parseNum(s: string): number {
  const t = s.trim();
  if (t.includes("/")) {
    const [a, b] = t.split("/").map(Number);
    return b ? a / b : NaN;
  }
  const m = t.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔])?$/);
  if (!m) return Number(t);
  return (m[1] ? Number(m[1]) : 0) + (m[2] ? FRAC[m[2]] : 0);
}

function fmtNum(n: number): string {
  const whole = Math.floor(n);
  const rest = n - whole;
  const fr = Object.entries(FRAC).find(([, v]) => Math.abs(v - rest) < 0.02);
  if (fr && whole === 0) return fr[0];
  if (fr && rest > 0.02) return `${whole}${fr[0]}`;
  return String(Math.round(n * 100) / 100);
}

/** Rewrite quantities written in prose ("Soak 1 cup whole green moong dal", "1.5 cups water", "4 walnuts"). */
export function portionText(text: string, opts: PortionOpts): string {
  const pref = opts.units ?? DEFAULT_UNITS;
  const factor = opts.factor ?? 1;
  if (factor === 1 && pref.solid === "original" && pref.liquid === "original" && pref.spoons === "keep") return text;
  return text.replace(TEXT_QTY, (whole, numStr: string, unitStr: string | undefined, rest: string | undefined) => {
    const after = rest ?? "";
    if (NOT_FOOD_AFTER.test(after) || (!unitStr && !after.trim())) return whole;
    const qty0 = parseNum(numStr);
    if (!Number.isFinite(qty0)) return whole;
    // Match the nearest words first: "4 walnuts in water" is walnuts, not water.
    const words = after.trim().split(/\s+/);
    let d: Density | null = null;
    let matchedName = "";
    for (let k = 1; k <= words.length && !d; k++) {
      matchedName = words.slice(0, k).join(" ");
      d = densityFor(matchedName);
    }
    if (!d) return whole;
    if (!unitStr && !d.piece?.each && !/rotis?|chillas?/i.test(after)) return whole; // bare numbers only for countable foods
    const ing = portionIngredient({ name: matchedName, qty: qty0, unit: unitStr }, { ...opts, units: pref, factor });
    const unitOut = ing.unit ? ` ${ing.unit}` : "";
    const hint = ing.note && /^≈/.test(ing.note) && !ing.unit?.match(/^(g|mg|kg|oz|ml|l)$/) ? ` (${ing.note})` : "";
    if (ing.qty === qty0 && ing.unit === unitStr && !hint) return whole;
    // keep the matched words, then the hint, then the rest of the sentence
    const tail = after.slice(after.indexOf(matchedName) + matchedName.length);
    return `${fmtNum(ing.qty!)}${unitOut} ${matchedName}${hint}${tail}`;
  });
}

// ---------------------------------------------------------------- whole recipe
export function portionRecipe(r: Recipe, opts: PortionOpts): Recipe {
  const factor = opts.factor ?? 1;
  const pref = opts.units ?? DEFAULT_UNITS;
  if (factor === 1 && pref.solid === "original" && pref.liquid === "original" && pref.spoons === "keep") return r;
  const drink = r.mealTypes.includes("wake") || r.textureTags.includes("liquid");
  const o: PortionOpts = { ...opts, scaleWater: opts.scaleWater ?? !drink };
  const t = (s: string) => portionText(s, o);
  return {
    ...r,
    description: t(r.description),
    ingredients: r.ingredients.map((i) => portionIngredient(i, o)),
    steps: r.steps.map((s) => ({ ...s, text: t(s.text), tip: s.tip ? t(s.tip) : s.tip })),
    leadTask: r.leadTask ? { ...r.leadTask, instruction: t(r.leadTask.instruction) } : r.leadTask,
    nutrition: r.nutrition && factor !== 1 ? { ...r.nutrition, kcal: Math.round(r.nutrition.kcal * factor), proteinG: Math.round(r.nutrition.proteinG * factor), carbG: Math.round(r.nutrition.carbG * factor), fiberG: Math.round(r.nutrition.fiberG * factor) } : r.nutrition,
    // Added fat never scales: the ≤ 1 tsp per meal cap is a hard rule.
    addedFatTsp: r.addedFatTsp,
  };
}

// ---------------------------------------------------------------- calorie targets
export const KCAL_MIN = 1200;
export const KCAL_MAX = 3500;
export const FACTOR_MIN = 0.5;
export const FACTOR_MAX = 2.5;

/** Factor that brings a day's planned kcal to the target, clamped to safe portion changes. */
export function calorieFactor(baseKcal: number, target: number): { factor: number; clamped: boolean } {
  if (!baseKcal || !target) return { factor: 1, clamped: false };
  const raw = target / baseKcal;
  const factor = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw));
  return { factor: Math.round(factor * 100) / 100, clamped: factor !== raw };
}
