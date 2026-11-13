import { apiError, handle } from "@/lib/server/api";
import { env } from "@/lib/env";
import { constantTimeEqual } from "@/lib/server/session";
import { tick } from "@/lib/server/notify";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || !constantTimeEqual(got, secret)) return apiError(401, "unauthorized", "Bad cron secret.");
  return handle(() => tick());
}
