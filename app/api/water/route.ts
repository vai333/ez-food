import { z } from "zod";
import { authed } from "@/lib/server/api";
import { logWater } from "@/lib/server/actions";

const In = z.object({ delta: z.union([z.literal(1), z.literal(-1)]).default(1) });
export const POST = authed(In, (u, i) => logWater(u, i.delta));
