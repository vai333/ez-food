import { isNull } from "drizzle-orm";
import { apiError, handle } from "@/lib/server/api";
import { env } from "@/lib/env";
import { constantTimeEqual } from "@/lib/server/session";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { queueDay } from "@/lib/server/notify";
import { activePlan, ensureDay, syncPrep } from "@/lib/server/today";
import { buildInsights } from "@/lib/server/learning";
import { addDays, toIst } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** Nightly: build tomorrow's schedule, queue its nudges, refresh insights. */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || !constantTimeEqual(got, secret)) return apiError(401, "unauthorized", "Bad cron secret.");
  return handle(async () => {
    const db = await getDb();
    const users = await db.select().from(s.users).where(isNull(s.users.deletedAt));
    const today = toIst().date;
    let n = 0;
    for (const u of users) {
      const plan = await activePlan(u.id);
      if (!plan) continue;
      for (const d of [today, addDays(today, 1)]) { await ensureDay(u, d); await queueDay(u, d); }
      await syncPrep(u);
      await buildInsights(u);
      n++;
    }
    return { users: n };
  });
}
