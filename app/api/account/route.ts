import { authed } from "@/lib/server/api";
import { deleteAccount } from "@/lib/server/account";
import { clearSession } from "@/lib/server/session";

export const DELETE = authed(null, async (u) => { await deleteAccount(u); await clearSession(); return { ok: true }; });
