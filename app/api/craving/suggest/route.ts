import { z } from "zod";
import { authed } from "@/lib/server/api";
import { suggest } from "@/lib/server/actions";
import { TASTE_TAGS } from "@/lib/types";

export const maxDuration = 30;
const In = z.object({ mealId: z.uuid(), cravings: z.array(z.enum(TASTE_TAGS)).max(6), pantry: z.array(z.string().max(40)).max(80).optional(), timeBudget: z.number().int().min(2).max(120).optional(), exclude: z.array(z.string().max(120)).max(20).optional(), note: z.string().max(300).optional() });

export const POST = authed(In, (u, i) => suggest(u, i));
