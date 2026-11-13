import { authed } from "@/lib/server/api";
import { exportData, exportTraining } from "@/lib/server/account";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const GET = authed(z.object({ kind: z.enum(["all", "training"]).default("all") }), async (u, i) => (i.kind === "training" ? { jsonl: (await exportTraining(u)).map((x) => JSON.stringify(x)).join("\n") } : exportData(u)));
