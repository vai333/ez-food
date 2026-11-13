/**
 * Notification queue + tick processor (build prompt §14). Max 6 nudges/day, quiet hours 22:00–06:00 (wake push
 * exempt), dedupe keys `kind:date:slot`, suppressed entirely in red-flag state. Sent by /api/cron/tick.
 */
import "server-only";
import webpush from "web-push";
import { and, eq, lte, sql, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { env } from "../env";
import { hm, istToUtc, toIst } from "../time";
import type { User } from "./session";

export const MAX_PER_DAY = 6;

type Nudge = { kind: string; minutes: number; slot?: string; title: string; body: string; url: string; action?: string };

export function planNudges(u: Pick<User, "learnedWakeTime" | "eatingWindowEnd" | "notifPrefs">, meals: { slot: string; plannedStart: number; status: string; title: string; activeMinutes: number }[], pendingPrep: { timeDue: number; instruction: string; key: string }[]): Nudge[] {
  const on = (k: string) => u.notifPrefs?.[k] !== false;
  const out: Nudge[] = [];
  const wake = hm(u.learnedWakeTime);
  if (on("wake_activation")) out.push({ kind: "wake_activation", minutes: wake, title: "Good morning ☀", body: "Warm ginger water first, then the day.", url: "/today?morning=1", action: "done" });
  for (const m of meals) {
    if (m.slot === "wake" || m.status !== "planned") continue;
    if (on("meal_prep")) out.push({ kind: "meal_prep", slot: m.slot, minutes: m.plannedStart - m.activeMinutes - 10, title: `${m.title} in ${m.activeMinutes + 10} min`, body: "Tap to start cooking. One step at a time.", url: "/today", action: "start" });
  }
  const dinner = meals.find((m) => m.slot === "dinner");
  if (on("window_closing") && dinner && dinner.status === "planned") out.push({ kind: "window_closing", minutes: hm(u.eatingWindowEnd) - 45, title: "Window closes at 8", body: "Dinner not logged yet. Need a 5-minute option?", url: "/today" });
  for (const p of pendingPrep.slice(0, 1)) if (on("prep_task")) out.push({ kind: "prep_task", slot: p.key, minutes: p.timeDue, title: "Tiny step for tomorrow", body: p.instruction, url: "/today" });
  if (on("hydration")) for (const t of [10 * 60 + 30, 15 * 60]) out.push({ kind: "hydration", slot: String(t), minutes: t, title: "Water break", body: t < hm("12:00") ? "A glass of water or plain green tea." : "One glass. Tap +1 when done.", url: "/today", action: "water" });
  if (on("nightly_reflection")) out.push({ kind: "nightly_reflection", minutes: hm(u.eatingWindowEnd) + 15, title: "Close the day", body: "Five quick taps: how did today feel?", url: "/progress?reflect=1" });

  // Quiet hours (except wake), cap 6, earliest first; wake + meal prep are prioritised.
  const prio: Record<string, number> = { wake_activation: 0, meal_prep: 1, prep_task: 2, window_closing: 3, nightly_reflection: 4, hydration: 5 };
  return out
    .filter((n) => n.kind === "wake_activation" || (n.minutes >= hm("06:00") && n.minutes < hm("22:00")))
    .sort((a, b) => prio[a.kind] - prio[b.kind] || a.minutes - b.minutes)
    .slice(0, MAX_PER_DAY)
    .sort((a, b) => a.minutes - b.minutes);
}

export async function queueDay(user: User, date: string) {
  const db = await getDb();
  if (user.redFlagUntil && user.redFlagUntil > new Date()) return 0;
  const meals = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), eq(s.scheduledMeals.date, date)));
  const prep = await db.select().from(s.prepTasks).where(and(eq(s.prepTasks.userId, user.id), eq(s.prepTasks.dateDue, date), eq(s.prepTasks.status, "pending")));
  const { recipeMap } = await import("./recipes");
  const rm = await recipeMap();
  const nudges = planNudges(user, meals.map((m) => ({ slot: m.slot, plannedStart: m.plannedStart, status: m.status, title: rm.get(m.plannedRecipes[0])?.titleEn ?? m.slot, activeMinutes: Math.max(...m.plannedRecipes.map((r) => rm.get(r)?.activeMinutes ?? 10)) })), prep.map((p) => ({ timeDue: p.timeDue, instruction: p.instruction, key: p.key })));
  const now = Date.now();
  let n = 0;
  for (const x of nudges) {
    const due = istToUtc(date, x.minutes);
    if (due.getTime() < now - 5 * 60_000) continue;
    const dedupeKey = `${user.id}:${x.kind}:${date}:${x.slot ?? ""}`;
    const rows = await db
      .insert(s.notificationQueue)
      .values({ userId: user.id, dueAt: due, kind: x.kind, payload: { title: x.title, body: x.body, url: x.url, action: x.action }, dedupeKey })
      .onConflictDoUpdate({ target: s.notificationQueue.dedupeKey, set: { dueAt: due, payload: { title: x.title, body: x.body, url: x.url, action: x.action } }, where: sql`${s.notificationQueue.status} = 'pending'` })
      .returning({ id: s.notificationQueue.id });
    n += rows.length;
  }
  return n;
}

function vapidReady() {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
  return true;
}

/** Send due notifications. Claims rows atomically (status pending → sending) so two ticks never double-send. */
export async function tick() {
  const db = await getDb();
  const now = new Date();
  const claimed = await db
    .update(s.notificationQueue)
    .set({ status: "sending", attempts: sql`${s.notificationQueue.attempts} + 1` })
    .where(and(eq(s.notificationQueue.status, "pending"), lte(s.notificationQueue.dueAt, now)))
    .returning();
  if (!claimed.length) return { sent: 0, failed: 0, skipped: 0 };
  const canPush = vapidReady();
  let sent = 0, failed = 0, skipped = 0;
  const users = new Map((await db.select().from(s.users).where(inArray(s.users.id, [...new Set(claimed.map((c) => c.userId))]))).map((u) => [u.id, u]));
  for (const n of claimed) {
    const u = users.get(n.userId);
    const stale = now.getTime() - n.dueAt.getTime() > 60 * 60_000;
    const suppressed = !u || (u.redFlagUntil && u.redFlagUntil > now) || stale || !(await stillRelevant(n));
    if (suppressed || !canPush) {
      await db.update(s.notificationQueue).set({ status: "cancelled" }).where(eq(s.notificationQueue.id, n.id));
      skipped++;
      continue;
    }
    const subs = await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, n.userId));
    let ok = false;
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ ...n.payload, kind: n.kind, id: n.id }), { urgency: n.kind === "wake_activation" ? "high" : "normal", TTL: 3600 });
        ok = true;
        await db.update(s.pushSubscriptions).set({ lastOkAt: now }).where(eq(s.pushSubscriptions.id, sub.id));
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.id, sub.id));
      }
    }
    if (ok) sent++;
    else failed++;
    await db.update(s.notificationQueue).set({ status: ok ? "sent" : n.attempts >= 3 ? "failed" : "pending", sentAt: ok ? now : null }).where(eq(s.notificationQueue.id, n.id));
  }
  return { sent, failed, skipped };
}

/** Suppress when the user already acted (meal logged, prep done). */
async function stillRelevant(n: typeof s.notificationQueue.$inferSelect): Promise<boolean> {
  const db = await getDb();
  const date = toIst(n.dueAt).date;
  if (n.kind === "wake_activation" || n.kind === "meal_prep" || n.kind === "window_closing") {
    const slot = n.kind === "wake_activation" ? "wake" : n.kind === "window_closing" ? "dinner" : n.dedupeKey.split(":")[3];
    const [m] = await db.select({ status: s.scheduledMeals.status }).from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, n.userId), eq(s.scheduledMeals.date, date), eq(s.scheduledMeals.slot, slot))).limit(1);
    return !m || m.status === "planned";
  }
  if (n.kind === "prep_task") {
    const [p] = await db.select({ status: s.prepTasks.status }).from(s.prepTasks).where(and(eq(s.prepTasks.userId, n.userId), eq(s.prepTasks.key, n.dedupeKey.split(":").slice(3).join(":")))).limit(1);
    return !p || p.status === "pending";
  }
  return true;
}
