import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authed } from "@/lib/server/api";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { buildInsights, forgetLearning } from "@/lib/server/learning";

export const dynamic = "force-dynamic";
export const GET = authed(null, async (u) => {
  const db = await getDb();
  let insights = await db.select().from(s.userInsights).where(and(eq(s.userInsights.userId, u.id))).orderBy(desc(s.userInsights.createdAt));
  if (!insights.length) { await buildInsights(u); insights = await db.select().from(s.userInsights).where(eq(s.userInsights.userId, u.id)); }
  const memories = await db.select().from(s.memoryChunks).where(eq(s.memoryChunks.userId, u.id)).orderBy(desc(s.memoryChunks.createdAt)).limit(40);
  const prefs = await db.select().from(s.preferenceScores).where(eq(s.preferenceScores.userId, u.id));
  return { paused: u.learningPaused, consent: u.consentPersonalisation, insights, memories, prefs: prefs.map((p) => ({ key: p.key, mean: p.alpha / (p.alpha + p.beta), n: p.n })).sort((a, b) => b.n - a.n).slice(0, 30) };
});

const In = z.discriminatedUnion("op", [
  z.object({ op: z.literal("insight"), id: z.uuid(), action: z.enum(["agree", "disagree", "edit", "dismiss"]), text: z.string().max(200).optional() }),
  z.object({ op: z.literal("memory"), id: z.uuid(), action: z.enum(["delete", "pin", "edit"]), text: z.string().max(200).optional() }),
  z.object({ op: z.literal("forget") }),
  z.object({ op: z.literal("rebuild") }),
]);
export const POST = authed(In, async (u, i) => {
  const db = await getDb();
  if (i.op === "forget") { await forgetLearning(u); return { ok: true }; }
  if (i.op === "rebuild") return { insights: await buildInsights(u) };
  if (i.op === "insight") {
    const status = i.action === "agree" ? "agreed" : i.action === "edit" ? "edited" : "dismissed";
    await db.update(s.userInsights).set({ status, userEditedText: i.text ?? null }).where(and(eq(s.userInsights.id, i.id), eq(s.userInsights.userId, u.id)));
    await db.insert(s.feedback).values({ userId: u.id, entityType: "insight", entityId: i.id, rating: i.action === "agree" ? 1 : i.action === "disagree" ? -1 : 0, freeText: i.text });
    return { ok: true };
  }
  if (i.action === "delete") await db.delete(s.memoryChunks).where(and(eq(s.memoryChunks.id, i.id), eq(s.memoryChunks.userId, u.id)));
  else await db.update(s.memoryChunks).set(i.action === "pin" ? { pinned: true } : { text: i.text ?? "" }).where(and(eq(s.memoryChunks.id, i.id), eq(s.memoryChunks.userId, u.id)));
  return { ok: true };
});
