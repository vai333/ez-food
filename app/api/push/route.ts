import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { authed } from "@/lib/server/api";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { queueDay } from "@/lib/server/notify";
import { toIst } from "@/lib/time";

const Sub = z.object({ op: z.enum(["subscribe", "unsubscribe"]), endpoint: z.url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }).optional() });
export const dynamic = "force-dynamic";
export const GET = authed(null, async () => ({ publicKey: env().VAPID_PUBLIC_KEY || null }));
export const POST = authed(Sub, async (u, i, req) => {
  const db = await getDb();
  if (i.op === "unsubscribe") { await db.delete(s.pushSubscriptions).where(and(eq(s.pushSubscriptions.endpoint, i.endpoint), eq(s.pushSubscriptions.userId, u.id))); return { ok: true }; }
  if (!i.keys) return { ok: false };
  await db.insert(s.pushSubscriptions).values({ userId: u.id, endpoint: i.endpoint, p256dh: i.keys.p256dh, auth: i.keys.auth, ua: req.headers.get("user-agent")?.slice(0, 200) }).onConflictDoUpdate({ target: s.pushSubscriptions.endpoint, set: { userId: u.id, p256dh: i.keys.p256dh, auth: i.keys.auth } });
  await queueDay(u, toIst().date);
  return { ok: true };
});
