import { z } from "zod";
import { authed } from "@/lib/server/api";
import { getPantry, setPantry } from "@/lib/server/actions";

export const dynamic = "force-dynamic";
export const GET = authed(null, (u) => getPantry(u));
export const POST = authed(z.object({ key: z.string().max(40), inStock: z.boolean() }), (u, i) => setPantry(u, i.key, i.inStock));
