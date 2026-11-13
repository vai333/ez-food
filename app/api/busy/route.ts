import { z } from "zod";
import { authed } from "@/lib/server/api";
import { addBusy, removeBusy } from "@/lib/server/actions";

const In = z.object({ start: z.number().int().min(0).max(1440), end: z.number().int().min(0).max(1440), label: z.string().max(40).default("Busy") }).refine((v) => v.end > v.start, "End must be after start");
export const POST = authed(In, (u, i) => addBusy(u, i.start, i.end, i.label));
export const DELETE = authed(z.object({ id: z.uuid() }), (u, i) => removeBusy(u, i.id));
