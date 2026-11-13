import { z } from "zod";
import { authed } from "@/lib/server/api";
import { completePrep } from "@/lib/server/actions";

const In = z.object({ taskId: z.uuid() });
export const POST = authed(In, (u, i) => completePrep(u, i.taskId));
