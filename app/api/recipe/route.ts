import { z } from "zod";
import { authed } from "@/lib/server/api";
import { userRecipe } from "@/lib/server/recipes";
import { personalCookMinutes } from "@/lib/server/actions";
import { HttpError } from "@/lib/server/session";
import { isShowable } from "@/lib/safety/validate";
import { logEvent } from "@/lib/server/learning";

const In = z.object({ slug: z.string().max(120) });

export const GET = authed(In, async (u, { slug }) => {
  const r = await userRecipe(u, slug);
  if (!r || !isShowable(r, { strictCapsicum: u.strictCapsicum, allowPendingValid: r.origin === "ai_generated" })) throw new HttpError(404, "not_found", "Recipe not found.");
  await logEvent(u, "meal_viewed", { entityType: "recipe", entityId: slug });
  return { recipe: r, personalMinutes: await personalCookMinutes(u, slug) };
});
