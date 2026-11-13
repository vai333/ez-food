import { z } from "zod";
import { authed } from "@/lib/server/api";
import { decideProposal } from "@/lib/server/coach";

/** The ONLY way a coach suggestion changes anything: the user confirms it here. */
export const POST = authed(z.object({ id: z.uuid(), action: z.enum(["confirm", "reject"]) }), (u, i) => decideProposal(u, i.id, i.action));
