import { z } from "zod";
import { authed } from "@/lib/server/api";
import { emergencyOptions } from "@/lib/server/actions";

const In = z.object({ mealId: z.uuid() });
export const POST = authed(In, (u, i) => emergencyOptions(u, i.mealId));
