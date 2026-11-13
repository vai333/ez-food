import { z } from "zod";
import { authed } from "@/lib/server/api";
import { acceptAlternative, rejectAlternative } from "@/lib/server/actions";
import { TASTE_TAGS } from "@/lib/types";

const In = z.object({ action: z.enum(["accept", "reject"]), mealId: z.uuid(), slug: z.string().max(120), cravings: z.array(z.enum(TASTE_TAGS)).max(6).default([]), reasonCodes: z.array(z.string().max(40)).max(6).default([]) });

export const POST = authed(In, (u, i) => (i.action === "accept" ? acceptAlternative(u, i.mealId, i.slug, i.cravings) : rejectAlternative(u, i.slug, i.reasonCodes)));
