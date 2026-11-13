import { z } from "zod";
import { authed } from "@/lib/server/api";
import { emergencyChoose } from "@/lib/server/actions";

const In = z.object({ mealId: z.uuid(), choice: z.enum(["grab", "assemble", "order"]), slug: z.string().max(120).optional() });
export const POST = authed(In, (u, i) => emergencyChoose(u, i.mealId, i.choice, i.slug));
