import { z } from "zod";
import { authed } from "@/lib/server/api";
import { clearRedFlag, earlyBreak } from "@/lib/server/actions";

const In = z.object({ op: z.enum(["early_break", "clear_red_flag"]) });
export const POST = authed(In, (u, i) => (i.op === "early_break" ? earlyBreak(u) : clearRedFlag(u)));
