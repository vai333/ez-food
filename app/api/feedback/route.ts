import { z } from "zod";
import { authed } from "@/lib/server/api";
import { giveFeedback } from "@/lib/server/actions";

const In = z.object({ entityType: z.enum(["recipe", "alternative", "intervention", "nudge", "insight", "quote"]), entityId: z.string().max(120), rating: z.number().int().min(-1).max(5), reasonCodes: z.array(z.string().max(40)).max(6).default([]) });
export const POST = authed(In, (u, i) => giveFeedback(u, i));
