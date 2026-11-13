import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authed } from "@/lib/server/api";
import { userRecipe } from "@/lib/server/recipes";
import { personalCookMinutes } from "@/lib/server/actions";
import { HttpError } from "@/lib/server/session";
import { isShowable } from "@/lib/safety/validate";
import { logEvent } from "@/lib/server/learning";

const In = z.object({ slug: z.string().max(120), meal: z.uuid().optional() });

export const GET = authed(In, async (u, { slug, meal }) => {
  // Portions follow the day of the meal being cooked (calorie targets differ per day's menu).
  let date: string | undefined;
  if (meal) {
    const db = await getDb();
    const [m] = await db.select({ date: s.scheduledMeals.date }).from(s.scheduledMeals).where(and(eq(s.scheduledMeals.id, meal), eq(s.scheduledMeals.userId, u.id))).limit(1);
    date = m?.date;
  }
  const r = await userRecipe(u, slug, date);
  if (!r || !isShowable(r, { strictCapsicum: u.strictCapsicum, allowPendingValid: r.origin === "ai_generated" })) throw new HttpError(404, "not_found", "Recipe not found.");
  await logEvent(u, "meal_viewed", { entityType: "recipe", entityId: slug });
  return { recipe: r, personalMinutes: await personalCookMinutes(u, slug) };
});
