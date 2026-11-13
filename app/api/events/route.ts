import { z } from "zod";
import { authed } from "@/lib/server/api";
import { logEvent } from "@/lib/server/learning";

const ALLOWED = ["app_open", "craving_pivot_opened", "intervention_shown", "intervention_dismissed", "nudge_tapped", "nudge_dismissed", "meal_viewed", "cook_step_completed"] as const;
const In = z.object({ events: z.array(z.object({ id: z.string().max(64), type: z.enum(ALLOWED), entityId: z.string().max(120).optional(), payload: z.record(z.string(), z.unknown()).optional(), ts: z.number().optional() })).max(100) });
export const POST = authed(In, async (u, i) => {
  for (const e of i.events) await logEvent(u, e.type, { clientEventId: e.id, entityId: e.entityId, payload: e.payload as Record<string, unknown>, at: e.ts && Math.abs(Date.now() - e.ts) < 7 * 86400_000 ? new Date(e.ts) : undefined });
  return { ok: true, n: i.events.length };
});
