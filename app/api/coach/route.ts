import { z } from "zod";
import { authed } from "@/lib/server/api";
import { getThread, resetThread, sendMessage } from "@/lib/server/coach";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const Thread = z.enum(["coach", "next_week"]);

export const GET = authed(z.object({ thread: Thread.default("coach") }), (u, i) => getThread(u, i.thread));
export const POST = authed(
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("send"), thread: Thread, text: z.string().min(1).max(1000) }),
    z.object({ op: z.literal("reset"), thread: Thread }),
  ]),
  (u, i) => (i.op === "send" ? sendMessage(u, i.thread, i.text) : resetThread(u, i.thread)),
);
