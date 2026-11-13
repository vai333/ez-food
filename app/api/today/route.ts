import { authed } from "@/lib/server/api";
import { buildToday } from "@/lib/server/today";

export const dynamic = "force-dynamic";
export const GET = authed(null, (u) => buildToday(u));
