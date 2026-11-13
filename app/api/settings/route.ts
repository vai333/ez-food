import { z } from "zod";
import { authed } from "@/lib/server/api";
import { publicProfile, updateSettings, rotateWakeToken } from "@/lib/server/account";

export const dynamic = "force-dynamic";
const In = z.object({
  displayName: z.string().min(1).max(40).optional(),
  strictCapsicum: z.boolean().optional(),
  consentPersonalisation: z.boolean().optional(),
  learningPaused: z.boolean().optional(),
  clinicianAware: z.boolean().optional(),
  dinnerCarb: z.enum(["rice", "roti"]).optional(),
  learnedWakeTime: z.string().regex(/^0[6-7]:[0-5]\d$|^08:00$/).optional(),
  notifPrefs: z.record(z.string().max(40), z.boolean()).optional(),
  languagePref: z.enum(["en", "hi", "hinglish"]).optional(),
  rotateWakeToken: z.boolean().optional(),
});
export const GET = authed(null, async (u) => publicProfile(u));
export const POST = authed(In, async (u, { rotateWakeToken: rot, ...patch }) => {
  const profile = await updateSettings(u, patch);
  return rot ? { ...profile, wakeToken: (await rotateWakeToken(u)).token } : profile;
});
