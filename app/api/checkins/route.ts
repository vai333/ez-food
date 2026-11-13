import { z } from "zod";
import { authed } from "@/lib/server/api";
import { submitCheckin } from "@/lib/server/actions";
import { REASON_CODES } from "@/lib/types";

const scale = z.number().int().min(1).max(5).optional();
const In = z.object({
  mealId: z.uuid().optional(),
  kind: z.enum(["deviation", "reflection", "unwell"]),
  deviationType: z.enum(["skipped", "late", "swapped", "emergency", "off_plan_item", "early_break"]).optional(),
  reasonCodes: z.array(z.enum(REASON_CODES)).max(13).default([]),
  reasonText: z.string().max(1000).optional(),
  mood: scale, hunger: scale, energy: scale, jointComfort: scale, digestion: scale,
  symptomFlags: z.array(z.string().max(40)).max(10).default([]),
  answers: z.record(z.string().max(40), z.string().max(500)).optional(),
  interventionShown: z.string().max(120).optional(),
  interventionHelped: z.boolean().optional(),
});
export const POST = authed(In, (u, i) => submitCheckin(u, i));
