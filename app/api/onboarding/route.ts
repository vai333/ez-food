import { z } from "zod";
import { handle } from "@/lib/server/api";
import { onboard } from "@/lib/server/account";
import { currentUser } from "@/lib/server/session";

const In = z.object({ name: z.string().max(40), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), disclaimerAck: z.literal(true), clinicianAware: z.boolean(), strictCapsicum: z.boolean(), consentPersonalisation: z.boolean(), wakeTime: z.string().regex(/^\d{2}:\d{2}$/).optional() });

export const POST = (req: Request) => handle(async () => onboard(In.parse(await req.json()), await currentUser()));
