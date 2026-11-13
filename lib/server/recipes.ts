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
import { personaliseRecipe, type Personalisation } from "../engine/personalise";
import { validateRecipe } from "../safety/validate";

export async function getPersonalisations(userId: string): Promise<(Personalisation & { id: string; createdAt: Date })[]> {
  const db = await getDb();
  const rows = await db.select().from(s.personalisations).where(_and(eq(s.personalisations.userId, userId), eq(s.personalisations.active, true))).orderBy(s.personalisations.createdAt);
  return rows.map((r) => ({ ...(r.payload as Personalisation), id: r.id, createdAt: r.createdAt }));
}

/**
 * Recipes as this user sees them: confirmed substitutions applied, avoided-ingredient recipes removed.
 * A personalised recipe that fails the validator falls back to the original (rules can't add banned foods).
 */
export function personaliseAll(list: Recipe[], rules: Personalisation[], strictCapsicum = true): Map<string, Recipe> {
  const out = new Map<string, Recipe>();
  for (const r of list) {
    const p = personaliseRecipe(r, rules);
    if (!p) continue;
    out.set(r.slug, validateRecipe(p, { strictCapsicum }).ok ? p : r);
  }
  return out;
}

export async function userRecipeMap(user: { id: string; strictCapsicum: boolean }): Promise<Map<string, Recipe>> {
  return personaliseAll(await allRecipes(), await getPersonalisations(user.id), user.strictCapsicum);
}

export async function userRecipe(user: { id: string; strictCapsicum: boolean }, slug: string): Promise<Recipe | null> {
  const r = await getRecipe(slug);
  if (!r) return null;
  return personaliseAll([r], await getPersonalisations(user.id), user.strictCapsicum).get(slug) ?? null;
}
