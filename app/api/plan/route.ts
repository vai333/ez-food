import { authed } from "@/lib/server/api";
import { planWeek } from "@/lib/server/today";

export const dynamic = "force-dynamic";
export const GET = authed(null, (u) => planWeek(u));
