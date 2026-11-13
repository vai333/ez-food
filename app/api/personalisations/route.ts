import { z } from "zod";
import { authed } from "@/lib/server/api";
import { getPersonalisations } from "@/lib/server/recipes";
import { removePersonalisation } from "@/lib/server/coach";

export const dynamic = "force-dynamic";
export const GET = authed(null, (u) => getPersonalisations(u.id));
export const DELETE = authed(z.object({ id: z.uuid() }), (u, i) => removePersonalisation(u, i.id));
