import { authed } from "@/lib/server/api";
import { gameSummary, markBadgesSeen } from "@/lib/server/game";
import { journeyStart } from "@/lib/server/today";

export const dynamic = "force-dynamic";
export const GET = authed(null, async (u) => gameSummary(u, await journeyStart(u.id)));
export const POST = authed(null, async (u) => { await markBadgesSeen(u); return { ok: true }; });
