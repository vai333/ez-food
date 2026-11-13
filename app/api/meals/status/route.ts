import { z } from "zod";
import { authed } from "@/lib/server/api";
import { markEaten, markSkipped, shiftMeal } from "@/lib/server/actions";

const In = z.discriminatedUnion("action", [
  z.object({ action: z.literal("eaten"), mealId: z.uuid() }),
  z.object({ action: z.literal("skipped"), mealId: z.uuid() }),
  z.object({ action: z.literal("shift"), mealId: z.uuid(), minutes: z.number().int().min(-120).max(120) }),
]);

export const POST = authed(In, (u, i) => (i.action === "eaten" ? markEaten(u, i.mealId) : i.action === "skipped" ? markSkipped(u, i.mealId) : shiftMeal(u, i.mealId, i.minutes)));
