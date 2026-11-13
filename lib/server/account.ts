/** Onboarding, settings, export, deletion and the wake webhook token. */
import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { toIst } from "../time";
import { defaultStartDate } from "../engine/plan";
import { PLAN } from "../seed/plan";
import { logEvent } from "./learning";
import { setSession, sha256, type User } from "./session";
import { queueDay } from "./notify";

export type OnboardInput = {
  name: string;
  startDate?: string;
  disclaimerAck: boolean;
  clinicianAware: boolean;
  strictCapsicum: boolean;
  consentPersonalisation: boolean;
  wakeTime?: string;
};

export async function onboard(input: OnboardInput, existing: User | null) {
  const db = await getDb();
  const now = new Date();
  const ist = toIst(now);
  let user = existing;
  const profile = {
    displayName: input.name.trim().slice(0, 40) || "Friend",
    disclaimerAckAt: input.disclaimerAck ? now : null,
    clinicianAware: input.clinicianAware,
    clinicianAwareAt: input.clinicianAware ? now : null,
    strictCapsicum: input.strictCapsicum,
    consentPersonalisation: input.consentPersonalisation,
    consentAt: now,
    learnedWakeTime: input.wakeTime ?? "06:45",
    onboardedAt: now,
  };
  if (!user) {
    [user] = await db.insert(s.users).values({ userRef: `u_${crypto.randomBytes(6).toString("hex")}`, ...profile }).returning();
  } else {
    [user] = await db.update(s.users).set({ ...profile, profileVersion: user.profileVersion + 1, updatedAt: now }).where(eq(s.users.id, user.id)).returning();
  }
  await db.update(s.userPlans).set({ status: "ended", endedAt: now }).where(eq(s.userPlans.userId, user.id));
  const startDate = input.startDate ?? defaultStartDate(ist.date, ist.minutes);
  await db.insert(s.userPlans).values({ userId: user.id, planSlug: PLAN.slug, startDate });
  await setSession(user.id);
  await logEvent(user, "settings_changed", { payload: { onboarding: true, startDate } });
  await queueDay(user, ist.date).catch(() => {});
  return { userId: user.id, startDate };
}

export type SettingsPatch = Partial<{ displayName: string; strictCapsicum: boolean; consentPersonalisation: boolean; learningPaused: boolean; clinicianAware: boolean; dinnerCarb: "rice" | "roti"; learnedWakeTime: string; notifPrefs: Record<string, boolean>; languagePref: string }>;

export async function updateSettings(user: User, patch: SettingsPatch) {
  const db = await getDb();
  const extra = patch.clinicianAware ? { clinicianAwareAt: new Date() } : {};
  const [u] = await db.update(s.users).set({ ...patch, ...extra, profileVersion: user.profileVersion + 1, updatedAt: new Date() }).where(eq(s.users.id, user.id)).returning();
  await logEvent(u, "settings_changed", { payload: { keys: Object.keys(patch) } });
  return publicProfile(u);
}

export function publicProfile(u: User) {
  return {
    name: u.displayName,
    strictCapsicum: u.strictCapsicum,
    consentPersonalisation: u.consentPersonalisation,
    learningPaused: u.learningPaused,
    clinicianAware: u.clinicianAware,
    dinnerCarb: u.dinnerCarb,
    learnedWakeTime: u.learnedWakeTime,
    eatingWindow: [u.eatingWindowStart, u.eatingWindowEnd],
    notifPrefs: u.notifPrefs,
    hasWakeHook: !!u.wakeHookTokenHash,
  };
}

/** New per-user wake webhook token; only the hash is stored. Returned once. */
export async function rotateWakeToken(user: User) {
  const token = crypto.randomBytes(24).toString("base64url");
  const db = await getDb();
  await db.update(s.users).set({ wakeHookTokenHash: sha256(token) }).where(eq(s.users.id, user.id));
  return { token };
}

export async function exportData(user: User) {
  const db = await getDb();
  const [plans, meals, ev, fb, ck, prefs, ins, mem, xp, ach, prep] = await Promise.all([
    db.select().from(s.userPlans).where(eq(s.userPlans.userId, user.id)),
    db.select().from(s.scheduledMeals).where(eq(s.scheduledMeals.userId, user.id)),
    db.select().from(s.events).where(eq(s.events.userId, user.id)),
    db.select().from(s.feedback).where(eq(s.feedback.userId, user.id)),
    db.select().from(s.checkins).where(eq(s.checkins.userId, user.id)),
    db.select().from(s.preferenceScores).where(eq(s.preferenceScores.userId, user.id)),
    db.select().from(s.userInsights).where(eq(s.userInsights.userId, user.id)),
    db.select().from(s.memoryChunks).where(eq(s.memoryChunks.userId, user.id)),
    db.select().from(s.xpLedger).where(eq(s.xpLedger.userId, user.id)),
    db.select().from(s.achievements).where(eq(s.achievements.userId, user.id)),
    db.select().from(s.prepTasks).where(eq(s.prepTasks.userId, user.id)),
  ]);
  const { wakeHookTokenHash: _h, ...profile } = user;
  void _h;
  return { exportedAt: new Date().toISOString(), profile, plans, meals, events: ev, feedback: fb, checkins: ck, preferences: prefs, insights: ins, memories: mem, xp, achievements: ach, prepTasks: prep };
}

/** De-identified (context, choice, outcome) tuples for future preference-model training (§12.6). Consent-gated. */
export async function exportTraining(user: User) {
  if (!user.consentPersonalisation) return [];
  const db = await getDb();
  const ev = await db.select().from(s.events).where(eq(s.events.userId, user.id)).orderBy(s.events.ts);
  const shown = new Map<string, { context: unknown; candidates: string[] }>();
  const out: object[] = [];
  for (const e of ev) {
    const sid = String(e.payload.suggestionId ?? e.payload.mealId ?? "");
    if (e.type === "alternative_shown") {
      const cur = shown.get(sid) ?? { context: { ...e.context, cravings: e.payload.cravings }, candidates: [] };
      cur.candidates.push(e.entityId ?? "");
      shown.set(sid, cur);
    }
    if (e.type === "alternative_accepted" || e.type === "alternative_rejected") {
      out.push({ context: e.context, candidates_shown: [...shown.values()].at(-1)?.candidates ?? [], choice: e.entityId, outcome: e.type === "alternative_accepted" ? 1 : 0 });
    }
  }
  return out;
}

/** Immediate hard delete (cascades through every user-owned table). */
export async function deleteAccount(user: User) {
  const db = await getDb();
  await db.delete(s.users).where(eq(s.users.id, user.id));
}
