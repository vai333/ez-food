import { eq } from "drizzle-orm";
import { handle, apiError } from "@/lib/server/api";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { constantTimeEqual, sha256 } from "@/lib/server/session";
import { logEvent } from "@/lib/server/learning";
import { toIst } from "@/lib/time";

/** Public, token-auth: iOS Shortcuts / MacroDroid call this when the wake alarm stops (build prompt §4.1 layer 1). */
const hits = new Map<string, number[]>();
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-wake-token") ?? "";
  if (!token || token.length > 100) return apiError(401, "bad_token", "Missing token.");
  const key = sha256(token);
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) return apiError(429, "rate_limited", "Slow down.");
  hits.set(key, [...recent, now]);
  return handle(async () => {
    const db = await getDb();
    const users = await db.select().from(s.users).where(eq(s.users.wakeHookTokenHash, key)).limit(1);
    const u = users.find((x) => x.wakeHookTokenHash && constantTimeEqual(x.wakeHookTokenHash, key));
    if (!u) return { ok: false };
    const date = toIst().date;
    const dedupeKey = `${u.id}:wake_hook:${date}`;
    const rows = await db.insert(s.notificationQueue).values({ userId: u.id, dueAt: new Date(), kind: "wake_activation", payload: { title: "Good morning", body: "Warm ginger water first, then the day.", url: "/today?morning=1", action: "done" }, dedupeKey }).onConflictDoNothing().returning({ id: s.notificationQueue.id });
    if (rows.length) {
      await db.update(s.notificationQueue).set({ status: "cancelled" }).where(eq(s.notificationQueue.dedupeKey, `${u.id}:wake_activation:${date}:`));
      await logEvent(u, "wake_detected", { payload: { via: "webhook" } });
    }
    return { ok: true, deduped: !rows.length };
  });
}
