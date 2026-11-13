import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { PLAN_RECIPES } from "../seed/plan";
import { CURATED_RECIPES } from "../seed/curated-recipes";
import type { Recipe } from "../types";

const SEEDED: Recipe[] = [...PLAN_RECIPES, ...CURATED_RECIPES];
const BY_SLUG = new Map(SEEDED.map((r) => [r.slug, r]));

export const seededRecipes = () => SEEDED;

/** Seeded (plan + curated) recipes plus AI recipes that are approved or pending review (pending ones re-validated at use). */
export async function allRecipes(): Promise<Recipe[]> {
  const db = await getDb();
  const rows = await db.select().from(s.recipes).where(inArray(s.recipes.status, ["approved", "pending_review"]));
  return [...SEEDED, ...rows.map((r) => ({ ...(r.data as Recipe), status: r.status as Recipe["status"] }))];
}

export async function getRecipe(slug: string): Promise<Recipe | null> {
  const seeded = BY_SLUG.get(slug);
  if (seeded) return seeded;
  const db = await getDb();
  const [row] = await db.select().from(s.recipes).where(eq(s.recipes.slug, slug)).limit(1);
  return row && row.status !== "rejected" ? { ...(row.data as Recipe), status: row.status as Recipe["status"] } : null;
}

export async function recipeMap(): Promise<Map<string, Recipe>> {
  return new Map((await allRecipes()).map((r) => [r.slug, r]));
}

// ---------- Personalised (per-user) views ----------
import { and as _and } from "drizzle-orm";
import { activeUnits, calorieTargetFor, personaliseRecipe, type Personalisation } from "../engine/personalise";
import { calorieFactor, portionRecipe } from "../engine/portions";
import { slotsForDate } from "../engine/plan";
import { validateRecipe } from "../safety/validate";
import { toIst } from "../time";
import { userPlans } from "./plans";

export async function getPersonalisations(userId: string): Promise<(Personalisation & { id: string; createdAt: Date })[]> {
  const db = await getDb();
  const rows = await db.select().from(s.personalisations).where(_and(eq(s.personalisations.userId, userId), eq(s.personalisations.active, true))).orderBy(s.personalisations.createdAt);
  return rows.map((r) => ({ ...(r.payload as Personalisation), id: r.id, createdAt: r.createdAt }));
}

/**
 * Recipes as this user sees them: confirmed substitutions applied, avoided-ingredient recipes removed.
 * A personalised recipe that fails the validator falls back to the original (rules can't add banned foods).
 */
export function personaliseAll(list: Recipe[], rules: Personalisation[], strictCapsicum = true, portion: { factor?: number } = {}): Map<string, Recipe> {
  const out = new Map<string, Recipe>();
  const units = activeUnits(rules);
  for (const r of list) {
    const p = personaliseRecipe(r, rules);
    if (!p) continue;
    const safe = validateRecipe(p, { strictCapsicum }).ok ? p : r;
    // Units + calorie portions last; re-validated so a portion change can never break a hard rule.
    const sized = portionRecipe(safe, { units, factor: portion.factor ?? 1 });
    out.set(r.slug, validateRecipe(sized, { strictCapsicum }).ok ? sized : safe);
  }
  return out;
}

type UserLike = { id: string; strictCapsicum: boolean };

/** Planned kcal for a date (≈ estimate) from the menu that covers it. */
export function plannedKcal(map: Map<string, Recipe>, slugs: string[]): number {
  return slugs.reduce((a, s) => a + (map.get(s)?.nutrition?.kcal ?? 0), 0);
}

/** Portion factor for a date from the user's calorie target (1 when no target). */
export async function portionContext(user: UserLike, date: string, rules?: Personalisation[]) {
  const r = rules ?? (await getPersonalisations(user.id));
  const target = calorieTargetFor(r, date);
  const base = personaliseAll(await allRecipes(), r, user.strictCapsicum);
  const slots = slotsForDate(await userPlans(user.id), date) ?? [];
  const baseKcal = plannedKcal(base, slots.flatMap((x) => x.recipeSlugs));
  const { factor, clamped } = target ? calorieFactor(baseKcal, target) : { factor: 1, clamped: false };
  return { rules: r, target, baseKcal, factor, clamped, plannedKcal: Math.round(baseKcal * factor) };
}

/** Recipes as this user sees them on `date` (default today): substitutions, avoids, units and calorie portions applied. */
export async function userRecipeMap(user: UserLike, date: string = toIst().date): Promise<Map<string, Recipe>> {
  const ctx = await portionContext(user, date);
  return personaliseAll(await allRecipes(), ctx.rules, user.strictCapsicum, { factor: ctx.factor });
}

export async function userRecipe(user: UserLike, slug: string, date: string = toIst().date): Promise<Recipe | null> {
  const r = await getRecipe(slug);
  if (!r) return null;
  const ctx = await portionContext(user, date);
  return personaliseAll([r], ctx.rules, user.strictCapsicum, { factor: ctx.factor }).get(slug) ?? null;
}
