import { desc, eq, inArray, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { authed } from "@/lib/server/api";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { HttpError, type User } from "@/lib/server/session";
import { validateRecipe } from "@/lib/safety/validate";
import type { Recipe } from "@/lib/types";

function admin(u: User) {
  const refs = env().ADMIN_USER_REFS.split(",").map((x) => x.trim()).filter(Boolean);
  // Single-user MVP: with no list configured, the only user is the admin.
  if (refs.length && !refs.includes(u.userRef)) throw new HttpError(403, "forbidden", "Admins only.");
}

export const dynamic = "force-dynamic";
export const GET = authed(null, async (u) => {
  admin(u);
  const db = await getDb();
  const rows = await db.select().from(s.recipes).where(inArray(s.recipes.status, ["pending_review"])).orderBy(desc(s.recipes.createdAt));
  const since = new Date(Date.now() - 30 * 86400_000);
  const calls = await db.select({ purpose: s.aiCalls.purpose, n: sql<number>`count(*)::int`, cache: sql<number>`sum(case when ${s.aiCalls.cacheHit} then 1 else 0 end)::int`, fallback: sql<number>`sum(case when ${s.aiCalls.fallbackUsed} then 1 else 0 end)::int`, tokens: sql<number>`coalesce(sum(${s.aiCalls.inputTokens} + ${s.aiCalls.outputTokens}),0)::int` }).from(s.aiCalls).where(gte(s.aiCalls.ts, since)).groupBy(s.aiCalls.purpose);
  return { pending: rows.map((r) => ({ id: r.id, slug: r.slug, recipe: r.data as Recipe, validator: validateRecipe(r.data as Recipe), createdAt: r.createdAt })), usage: calls, userRef: u.userRef };
});
export const POST = authed(z.object({ id: z.uuid(), action: z.enum(["approve", "reject"]) }), async (u, i) => {
  admin(u);
  const db = await getDb();
  const [row] = await db.select().from(s.recipes).where(eq(s.recipes.id, i.id));
  if (!row) throw new HttpError(404, "not_found", "Not found");
  if (i.action === "approve" && !validateRecipe(row.data as Recipe).ok) throw new HttpError(400, "invalid", "Validator still fails; can't approve.");
  const status = i.action === "approve" ? "approved" : "rejected";
  await db.update(s.recipes).set({ status, data: { ...(row.data as Recipe), status }, updatedAt: new Date() }).where(eq(s.recipes.id, i.id));
  return { ok: true };
});
