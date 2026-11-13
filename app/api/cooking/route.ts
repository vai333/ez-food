import { z } from "zod";
import { authed } from "@/lib/server/api";
import { cookEvent } from "@/lib/server/actions";

const In = z.object({ kind: z.enum(["cook_started", "cook_step_completed", "cook_completed", "cook_abandoned"]), recipeSlug: z.string().max(120), mealId: z.uuid().optional(), step: z.number().int().optional() });

export const POST = authed(In, (u, i) => cookEvent(u, i.kind, i.recipeSlug, i.mealId, { step: i.step }));
