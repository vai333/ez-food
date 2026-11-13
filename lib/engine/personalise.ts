/**
 * Personal rules the user confirmed in chat, applied on top of every recipe. Pure.
 * - substitute: "water" → "alkaline water" in chosen recipes (or all)
 * - avoid: drop recipes that need an ingredient (optional uses are just removed)
 * - hydration_drink: what the water counter tracks ("alkaline water")
 * Every personalised recipe is re-validated by the caller; a rule can never smuggle in a banned food.
 */
import type { Recipe } from "../types";
import { DEFAULT_UNITS, type UnitPref } from "./portions";

export type Personalisation =
  | { kind: "substitute"; from: string; to: string; recipes: string[] | "all"; reason?: string }
  | { kind: "avoid"; ingredient: string; reason?: string }
  | { kind: "hydration_drink"; name: string }
  | { kind: "units"; units: UnitPref }
  /** date set = only that day ("2200 kcal today"); unset = every day until changed */
  | { kind: "calorie_target"; kcal: number; date?: string }
  | { kind: "note"; text: string };

/** Latest unit preference wins. */
export function activeUnits(rules: Personalisation[]): UnitPref {
  const u = [...rules].reverse().find((p) => p.kind === "units") as { units: UnitPref } | undefined;
  return u?.units ?? DEFAULT_UNITS;
}

/** The calorie target for a date: a day-specific one beats the ongoing one; the latest of each kind wins. */
export function calorieTargetFor(rules: Personalisation[], date: string): number | null {
  const t = [...rules].reverse().filter((p) => p.kind === "calorie_target") as { kcal: number; date?: string }[];
  return (t.find((x) => x.date === date) ?? t.find((x) => !x.date))?.kcal ?? null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const wordRe = (w: string) => new RegExp(`(^|[^a-z])(${esc(w.trim().toLowerCase())})(?=$|[^a-z])`, "gi");

function casePreserving(match: string, to: string) {
  return match[0] === match[0].toUpperCase() ? to.replace(/\b\w/g, (c) => c.toUpperCase()) : to;
}

export function replaceWord(text: string, from: string, to: string): string {
  // Don't double-apply ("alkaline water" already contains "water").
  const guard = to.toLowerCase().includes(from.toLowerCase()) ? new RegExp(esc(to), "i") : null;
  if (guard && guard.test(text)) return text;
  return text.replace(wordRe(from), (_m, pre: string, word: string) => pre + casePreserving(word, to));
}

export function mentions(text: string, word: string): boolean {
  return wordRe(word).test(text);
}

export function applySubstitution(r: Recipe, from: string, to: string): Recipe {
  return {
    ...r,
    titleEn: replaceWord(r.titleEn, from, to),
    description: replaceWord(r.description, from, to),
    ingredients: r.ingredients.map((i) => ({ ...i, name: replaceWord(i.name, from, to), note: i.note ? replaceWord(i.note, from, to) : i.note })),
    steps: r.steps.map((s) => ({ ...s, text: replaceWord(s.text, from, to), tip: s.tip ? replaceWord(s.tip, from, to) : s.tip })),
  };
}

/** True when the recipe can't be made without this ingredient. */
export function needsIngredient(r: Recipe, ingredient: string): boolean {
  return r.ingredients.some((i) => !i.optional && mentions(i.name, ingredient));
}

/** Returns the personalised recipe, or null if an avoided ingredient is essential to it. */
export function personaliseRecipe(r: Recipe, rules: Personalisation[]): Recipe | null {
  let out = r;
  for (const p of rules) {
    if (p.kind === "avoid") {
      if (needsIngredient(out, p.ingredient)) return null;
      out = { ...out, ingredients: out.ingredients.filter((i) => !mentions(i.name, p.ingredient)) };
    }
    if (p.kind === "substitute" && (p.recipes === "all" || p.recipes.includes(r.slug))) out = applySubstitution(out, p.from, p.to);
  }
  return out;
}

export type RecipeDiff = { slug: string; title: string; changes: { before: string; after: string }[] };

export function diffRecipe(before: Recipe, after: Recipe): RecipeDiff | null {
  const changes: { before: string; after: string }[] = [];
  before.ingredients.forEach((i, k) => {
    const a = after.ingredients[k];
    if (a && a.name !== i.name) changes.push({ before: i.name, after: a.name });
  });
  before.steps.forEach((s, k) => {
    const a = after.steps[k];
    if (a && a.text !== s.text) changes.push({ before: s.text, after: a.text });
  });
  return changes.length ? { slug: before.slug, title: before.titleEn, changes } : null;
}

export function hydrationDrink(rules: Personalisation[]): string {
  const h = [...rules].reverse().find((p) => p.kind === "hydration_drink") as { name: string } | undefined;
  return h?.name ?? "water";
}
