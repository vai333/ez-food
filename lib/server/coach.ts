/**
 * Coach: chat threads, proposals and confirmations.
 * Flow per user message: safety pre-checks → Gemini (or scripted fallback) → each proposal validated and previewed in
 * code → stored as "pending" → applied ONLY when the user taps Confirm. Blocked proposals explain why.
 */
import "server-only";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { addDays, hm, toIst } from "../time";
import { renderConstraints } from "../ai/prompts";
import { llmJson } from "../ai/gemini";
import { llmConfigured } from "../env";
import { CoachOut, CoachOutSchemaHint, ProposalIn, coachContext, coachSystem, lintCoachReply, toProposals, type ProposalInT } from "../ai/coach";
import { checkWeekMenu, defaultWeekMenu, planEnd, planForDate, slotFitsRecipe, type WeekMenu } from "../engine/plan";
import { diffRecipe, needsIngredient, personaliseRecipe, type Personalisation, type RecipeDiff } from "../engine/personalise";
import { planNextWeek } from "../engine/weekplanner";
import { detectRedFlags, isMedicationQuestion, MEDICATION_REPLY } from "../safety/redflags";
import { scanText, validateRecipe } from "../safety/validate";
import { SLOT_LABEL } from "../seed/plan";
import type { MealSlot, Recipe } from "../types";
import { allRecipes, getPersonalisations, personaliseAll, plannedKcal, portionContext } from "./recipes";
import { activeUnits } from "../engine/personalise";
import { calorieFactor, KCAL_MAX, KCAL_MIN, portionRecipe, type UnitPref } from "../engine/portions";
import { slotsForDate } from "../engine/plan";
import { userPlans, type UserPlan } from "./today";
import { logEvent, posteriors, remember } from "./learning";
import type { User } from "./session";

export type Thread = "coach" | "next_week";

// ---------------------------------------------------------------- reading
export async function getThread(user: User, thread: Thread) {
  const db = await getDb();
  let msgs = await db.select().from(s.chatMessages).where(and(eq(s.chatMessages.userId, user.id), eq(s.chatMessages.thread, thread))).orderBy(asc(s.chatMessages.createdAt));
  if (!msgs.length) {
    const opener = await openingMessage(user, thread);
    await db.insert(s.chatMessages).values({ userId: user.id, thread, role: "assistant", content: opener.text, quickReplies: opener.quick });
    msgs = await db.select().from(s.chatMessages).where(and(eq(s.chatMessages.userId, user.id), eq(s.chatMessages.thread, thread))).orderBy(asc(s.chatMessages.createdAt));
    // Two tabs (or a double render) can both open an empty thread; keep only the first opener.
    const dupes = msgs.slice(1).filter((m, i) => m.role === "assistant" && msgs.slice(0, i + 1).every((x) => x.role === "assistant"));
    if (dupes.length) {
      await db.delete(s.chatMessages).where(inArray(s.chatMessages.id, dupes.map((d) => d.id)));
      msgs = msgs.filter((m) => !dupes.some((d) => d.id === m.id));
    }
  }
  const props = await db.select().from(s.planProposals).where(and(eq(s.planProposals.userId, user.id), eq(s.planProposals.thread, thread))).orderBy(asc(s.planProposals.createdAt));
  return {
    thread,
    ai: llmConfigured(),
    messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, quickReplies: m.quickReplies, createdAt: m.createdAt, proposals: props.filter((p) => p.messageId === m.id).map(publicProposal) })),
  };
}

function publicProposal(p: typeof s.planProposals.$inferSelect) {
  return { id: p.id, kind: p.kind, status: p.status, blockedReason: p.blockedReason, preview: p.preview };
}

export async function resetThread(user: User, thread: Thread) {
  const db = await getDb();
  await db.update(s.planProposals).set({ status: "superseded" }).where(and(eq(s.planProposals.userId, user.id), eq(s.planProposals.thread, thread), eq(s.planProposals.status, "pending")));
  await db.delete(s.chatMessages).where(and(eq(s.chatMessages.userId, user.id), eq(s.chatMessages.thread, thread)));
  return getThread(user, thread);
}

// ---------------------------------------------------------------- context
async function weekStats(user: User, plans: UserPlan[]) {
  const db = await getDb();
  const today = toIst().date;
  const ctx = planForDate(plans, today);
  const plan = ctx?.plan ?? plans[plans.length - 1];
  const meals = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), gte(s.scheduledMeals.date, plan?.startDate ?? today)));
  const by = (st: string[]) => meals.filter((m) => m.slot !== "wake" && st.includes(m.status)).length;
  const food = meals.filter((m) => m.slot !== "wake" && m.date <= today);
  const skipsBySlot = new Map<string, number>();
  for (const m of food) if (["skipped", "missed"].includes(m.status)) skipsBySlot.set(m.slot, (skipsBySlot.get(m.slot) ?? 0) + 1);
  const cks = await db.select({ r: s.checkins.reasonCodes }).from(s.checkins).where(and(eq(s.checkins.userId, user.id), gte(s.checkins.date, plan?.startDate ?? today)));
  const reasons = new Map<string, number>();
  for (const c of cks) for (const r of c.r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  const post = await posteriors(user.id, "recipe:");
  const ranked = [...post.entries()].map(([k, p]) => ({ slug: k.slice(7), mean: p.alpha / (p.alpha + p.beta), n: p.n })).filter((x) => x.n >= 1);
  const liked = ranked.filter((x) => x.mean >= 0.6).sort((a, b) => b.mean - a.mean).map((x) => x.slug);
  const disliked = ranked.filter((x) => x.mean <= 0.35 && x.n >= 2).map((x) => x.slug);
  const acks = meals.filter((m) => m.slot === "wake" && m.status === "eaten").length;
  return {
    plan,
    liked,
    disliked,
    text: [
      `week ${plan?.weekNo ?? 1}, day ${ctx?.dayNo ?? 0} of ${plan?.lengthDays ?? 7}`,
      `meals on plan ${by(["eaten"])}, adapted swaps ${by(["swapped"])}, on-the-go ${by(["emergency"])}, skipped or passed ${by(["skipped", "missed"])} of ${food.length} so far`,
      `ginger water done ${acks} times`,
      `skips by slot: ${[...skipsBySlot.entries()].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
      `reasons given: ${[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k.replace(/_/g, " ")} ×${v}`).join(", ") || "none"}`,
      `liked: ${liked.slice(0, 6).join(", ") || "not enough data"}; disliked: ${disliked.slice(0, 4).join(", ") || "none"}`,
    ].join("; "),
  };
}

function menuText(menu: WeekMenu, recipes: Map<string, Recipe>) {
  return menu.days
    .map((d) => `D${d.dayNo}: ${d.slots.filter((x) => x.slot !== "wake").map((x) => `${x.slot} ${x.time} ${x.recipes.map((r) => recipes.get(r)?.titleEn ?? r).join(" + ")}`).join("; ")}`)
    .join("\n");
}

function catalogText(recipes: Map<string, Recipe>) {
  return [...recipes.values()]
    .filter((r) => r.status === "approved" && !r.needsDoctorOk) // wake drink included so preferences can reach it; slot rules stop it moving
    .map((r) => `${r.slug} | ${r.titleEn} | ${r.mealTypes.join("/")}${r.quickAssemble ? "/quick" : ""} | ${r.tasteTags.join(",")} | ${r.activeMinutes} | ${r.addedFatTsp}`)
    .join("\n");
}

function describeRule(p: Personalisation): string {
  if (p.kind === "units") return `quantities shown in ${p.units.solid === "original" ? "cups" : p.units.solid} / ${p.units.liquid === "original" ? "cups" : p.units.liquid}${p.units.spoons === "metric" ? ", spoons converted too" : ""}`;
  if (p.kind === "calorie_target") return `calorie target ${p.kcal} kcal ${p.date ? `on ${p.date}` : "every day"}`;
  if (p.kind === "substitute") return `use ${p.to} instead of ${p.from}${p.recipes === "all" ? "" : ` in ${p.recipes.length} recipes`}`;
  if (p.kind === "avoid") return `avoid ${p.ingredient}`;
  if (p.kind === "hydration_drink") return `tracks ${p.name} as daily drink`;
  if (p.kind === "note") return p.text;
  return "";
}

// ---------------------------------------------------------------- opening messages
async function openingMessage(user: User, thread: Thread): Promise<{ text: string; quick: string[] }> {
  if (thread === "coach") {
    return {
      text: `Hi ${user.displayName}. Tell me anything about your food: a drink you'd like to switch to, something you want to avoid, a meal you're bored of. I'll suggest exactly what would change, and nothing changes until you confirm it.`,
      quick: ["I'd like to drink alkaline water", "I don't like lauki", "Make snacks quicker"],
    };
  }
  const plans = await userPlans(user.id);
  const st = await weekStats(user, plans);
  const db = await getDb();
  const meals = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), gte(s.scheduledMeals.date, st.plan?.startDate ?? toIst().date)));
  const done = meals.filter((m) => m.slot !== "wake" && ["eaten", "swapped", "emergency"].includes(m.status)).length;
  const total = meals.filter((m) => m.slot !== "wake" && m.date <= toIst().date).length;
  // Compassion: only quote the number when it's something to build on.
  const recap = done > 0 ? `You kept ${done} of ${total} meals on plan this week${done / Math.max(1, total) >= 0.7 ? ", a strong week" : ", and every one counts"}.` : "Your week is wrapping up, and a fresh one is a good place to start.";
  return {
    text: `${recap} Let's shape your next 7 days together. What's your main goal for the coming week?`,
    quick: ["More energy", "Less cooking time", "More variety", "Steadier digestion"],
  };
}

// ---------------------------------------------------------------- sending a message
export async function sendMessage(user: User, thread: Thread, text: string) {
  const db = await getDb();
  const clean = text.trim().slice(0, 1000);
  await db.insert(s.chatMessages).values({ userId: user.id, thread, role: "user", content: clean });
  await logEvent(user, "coach_message", { payload: { thread } });

  // Typing "confirm" is an explicit OK: confirm what the latest coach message proposed (same path as the button).
  if (/\bconfirm\b/i.test(clean) && !/\b(don'?t|do not|not|no)\b/i.test(clean)) {
    const [lastAssistant] = await db.select().from(s.chatMessages).where(and(eq(s.chatMessages.userId, user.id), eq(s.chatMessages.thread, thread), eq(s.chatMessages.role, "assistant"))).orderBy(desc(s.chatMessages.createdAt)).limit(1);
    const waiting = lastAssistant ? await db.select().from(s.planProposals).where(and(eq(s.planProposals.userId, user.id), eq(s.planProposals.messageId, lastAssistant.id), eq(s.planProposals.status, "pending"))) : [];
    if (waiting.length) {
      for (const w of waiting) await decideProposal(user, w.id, "confirm");
      return getThread(user, thread);
    }
  }

  // Safety first: medicines → fixed reply; red flags → pause and point to a doctor. No plan changes in either case.
  if (isMedicationQuestion(clean)) return reply(user, thread, MEDICATION_REPLY, [], []);
  const rf = detectRedFlags(clean);
  if (rf.flagged) {
    await db.update(s.users).set({ redFlagUntil: new Date(Date.now() + 24 * 3600_000) }).where(eq(s.users.id, user.id));
    await logEvent(user, "red_flag_triggered", { payload: { via: "coach", matches: rf.matches.map((m) => m.key) } });
    return reply(user, thread, `What you described (${rf.matches.map((m) => m.label.toLowerCase()).join(", ")}) needs a doctor, so I've paused nudges and plan changes for today. Please contact your doctor, or call 112 if it feels severe. We can plan food once you've been seen.`, [], []);
  }

  const plans = await userPlans(user.id);
  const rules = await getPersonalisations(user.id);
  const recipes = personaliseAll(await allRecipes(), rules, user.strictCapsicum);
  const todayKcal = await portionContext(user, toIst().date, rules);
  const st = await weekStats(user, plans);
  const history = await db.select().from(s.chatMessages).where(and(eq(s.chatMessages.userId, user.id), eq(s.chatMessages.thread, thread))).orderBy(desc(s.chatMessages.createdAt)).limit(20);
  const current = st.plan ? (st.plan.menu ?? defaultWeekMenu()) : defaultWeekMenu();
  const nextExists = !!st.plan && plans.some((p) => p.startDate > st.plan!.startDate);

  let out: { reply: string; quick: string[]; proposals: ProposalInT[] } | null = null;
  if (llmConfigured()) {
    const res = await llmJson({
      purpose: `coach_${thread}`,
      userId: user.id,
      system: coachSystem(renderConstraints(user.strictCapsicum, user.eatingWindowStart, user.eatingWindowEnd), thread),
      prompt: `${coachContext({
        profile: `eating window ${user.eatingWindowStart}-${user.eatingWindowEnd} IST; wake ~${user.learnedWakeTime}; all chillies avoided: ${user.strictCapsicum}; dinner carb ${user.dinnerCarb}; today's planned ≈ ${todayKcal.plannedKcal} kcal (menu as written ≈ ${todayKcal.baseKcal})${todayKcal.target ? `, target ${todayKcal.target}` : ""}`,
        currentWeek: menuText(current, recipes),
        weekStats: st.text,
        personal: rules.map(describeRule).join("; "),
        goals: (st.plan?.goals ?? []).join("; "),
        catalog: catalogText(recipes),
        nextWeekExists: nextExists,
      })}\n<conversation>\n${history.reverse().map((m) => `${m.role}: ${scrubName(m.content, user.displayName)}`).join("\n")}\n</conversation>\nReply to the user's last message.`,
      schema: CoachOut,
      schemaHint: CoachOutSchemaHint,
      temperature: 0.5,
      maxOutputTokens: 6000,
      cacheKeyExtra: `${user.profileVersion}:${history.length}`,
    });
    if (res.ok) {
      out = {
        reply: lintCoachReply(res.data.reply).text,
        quick: res.data.quickReplies ?? [],
        proposals: toProposals(res.data).map((p) => ProposalIn.safeParse(p)).filter((p) => p.success).map((p) => p.data!),
      };
    }
  }
  if (!out) out = await fallback(user, thread, clean, st);
  // Guard: an incomplete week plan (models sometimes drop the days) is rebuilt by the deterministic planner from the
  // user's own words, so the user never confirms a plan that doesn't match what was discussed.
  const wp = out.proposals.find((p) => p.kind === "week_plan");
  if (wp && (wp.days?.length ?? 0) < 7) {
    const said = history.filter((m) => m.role === "user").map((m) => m.content);
    const goals = wp.goals?.length ? wp.goals : [said[0] ?? "Keep the routine"];
    const recipesNow = personaliseAll(await allRecipes(), rules, user.strictCapsicum);
    const quick = /15|quick|less cooking|busy|office|time/i.test(said.join(" ") + goals.join(" "));
    const built = planNextWeek({ recipes: recipesNow, goals: [...goals, ...said], liked: st.liked, disliked: st.disliked, cookMinutes: quick ? 15 : undefined });
    wp.days = built.menu.days.map((d) => ({ dayNo: d.dayNo, label: d.label, breakfast: d.slots.find((x) => x.slot === "breakfast")!.recipes, snack: d.slots.find((x) => x.slot === "snack")!.recipes, dinner: d.slots.find((x) => x.slot === "dinner")!.recipes }));
    wp.goals = goals;
    wp.summary = wp.summary || (built.notes.length ? `Built for "${goals[0]}": ${built.notes.length} meals changed.` : `Built for "${goals[0]}".`);
  }
  return reply(user, thread, out.reply, out.quick, out.proposals);
}

/** No PII to the LLM: the user's name never leaves the server (build prompt §3.4). */
function scrubName(text: string, name: string): string {
  const n = name.trim();
  if (n.length < 2) return text;
  return text.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "there");
}

async function reply(user: User, thread: Thread, text: string, quick: string[], proposals: ProposalInT[]) {
  // eslint-disable-next-line no-param-reassign
  const db = await getDb();
  // Answer "how many grams?" directly: the app (not the model) computed the numbers, so state them in the reply.
  const numbers: string[] = [];
  for (const p of proposals) {
    if (p.kind !== "set_calorie_target" && p.kind !== "set_units") continue;
    const v = await validateProposal(user, p);
    // One line per recipe, preferring the soak instruction, max two recipes.
    const first = ((v.preview.recipes as RecipeDiff[] | undefined) ?? [])
      .map((r) => (r.changes.find((c) => /^Soak/i.test(c.after)) ?? r.changes.find((c) => /\d\s*(g|mg|kg|oz|ml|l)\b/.test(c.after)))?.after)
      .filter((x): x is string => !!x)
      .slice(0, 2);
    if (v.status === "pending" && first.length) numbers.push(...first);
  }
  if (numbers.length) text = `${text}\n\nIn numbers: ${numbers.map((n) => n.replace(/\.$/, "")).join("; ")}.`;
  // Confirming happens on the cards (or by typing "confirm"); drop vague "yes/looks good" chips so taps are never ambiguous.
  const chips = quick.filter((q) => !/^(yes|ok|okay|sure|looks good|perfect|great|confirm\b)/i.test(q.trim())).slice(0, 4);
  const [msg] = await db.insert(s.chatMessages).values({ userId: user.id, thread, role: "assistant", content: text, quickReplies: chips }).returning();
  for (const p of proposals.slice(0, 4)) {
    const v = await validateProposal(user, p);
    if (v.drop) continue;
    if (p.kind === "week_plan" && v.status === "pending") {
      await db.update(s.planProposals).set({ status: "superseded" }).where(and(eq(s.planProposals.userId, user.id), eq(s.planProposals.kind, "week_plan"), eq(s.planProposals.status, "pending")));
    }
    await db.insert(s.planProposals).values({ userId: user.id, messageId: msg.id, thread, kind: p.kind, payload: v.payload, preview: v.preview, status: v.status, blockedReason: v.blockedReason });
  }
  return getThread(user, thread);
}

// ---------------------------------------------------------------- scripted fallback (no AI)
async function fallback(user: User, thread: Thread, text: string, st: Awaited<ReturnType<typeof weekStats>>): Promise<{ reply: string; quick: string[]; proposals: ProposalInT[] }> {
  const t = text.toLowerCase();
  const kcalM = t.match(/(\d{3,5})\s*(?:k?cal|calories|kcal)/);
  const unitM = t.match(/\b(milligrams?|mg|kilograms?|kg|grams?|gm|ounces?|oz)\b/);
  if (kcalM || unitM) {
    const proposals: ProposalInT[] = [];
    if (unitM) {
      const w = unitM[1];
      const solid = /^m(illi)?g/.test(w) || w === "mg" ? "mg" : /^k/.test(w) ? "kg" : /^o/.test(w) ? "oz" : "g";
      proposals.push({ kind: "set_units", solid, liquid: "ml", spoons: /everything|all|spoon|tsp/.test(t) ? "metric" : "keep" });
    }
    if (kcalM) proposals.push({ kind: "set_calorie_target", kcal: Number(kcalM[1]), scope: /\btoday\b/.test(t) ? "today" : "ongoing" });
    return { reply: "Here's exactly what would change. Tap Confirm on each card you want.", quick: [], proposals };
  }
  const drink = t.match(/(?:drink|switch to|use|prefer|have)\s+([a-z ]*?water|green tea|black coffee)\b/);
  if (drink && drink[1].trim() !== "water") {
    const name = drink[1].trim();
    return {
      reply: `Got it: ${name}. I can use it for your morning ginger drink and buttermilk, and track it in your daily glasses. Tap Confirm on each change you want.`,
      quick: [],
      proposals: [
        { kind: "substitute_ingredient", from: "water", to: name, recipes: ["morning-flush", "spiced-buttermilk-walnuts", "plain-buttermilk", "ginger-pepper-buttermilk"], reason: `You'd like to drink ${name}.` },
        { kind: "hydration_drink", drink: name },
      ],
    };
  }
  const avoid = t.match(/(?:avoid|no|don'?t (?:like|want|eat)|hate|allergic to|skip)\s+([a-z ]{3,30}?)(?:[.,!]|$| please| anymore)/);
  if (avoid && thread === "coach") {
    const ing = avoid[1].trim();
    return { reply: `Understood, no ${ing}. Here's what would change in your meals. Confirm if it looks right.`, quick: [], proposals: [{ kind: "avoid_ingredient", ingredient: ing, reason: `You'd rather not have ${ing}.` }] };
  }
  if (thread === "next_week") {
    const db = await getDb();
    const userMsgs = (await db.select({ c: s.chatMessages.content }).from(s.chatMessages).where(and(eq(s.chatMessages.userId, user.id), eq(s.chatMessages.thread, "next_week"), eq(s.chatMessages.role, "user")))).map((m) => m.c);
    if (userMsgs.length === 1) return { reply: "Thanks. On a typical weekday, how much time can you give to cooking one meal?", quick: ["Under 15 min", "About 30 min", "Happy to cook"], proposals: [] };
    if (userMsgs.length === 2) return { reply: "Anything you'd like more of, or less of, next week? (Say 'nothing' if the plan felt right.)", quick: ["More crunchy snacks", "Less lauki", "Nothing"], proposals: [] };
    const goals = userMsgs.slice(0, 1);
    const quick = /15|quick|less/.test(userMsgs[1] ?? "");
    const recipes = personaliseAll(await allRecipes(), await getPersonalisations(user.id), user.strictCapsicum);
    const { menu, notes } = planNextWeek({ recipes, goals: [...goals, quick ? "less cooking time" : ""], liked: st.liked, disliked: st.disliked, cookMinutes: quick ? 12 : undefined });
    return {
      reply: `Here's a draft for your next 7 days, built around "${goals[0]}". ${notes.length ? `${notes.length} meals changed from last week.` : "It keeps last week's rhythm."} Review it and tap Confirm, or tell me what to change.`,
      quick: ["Change a meal", "Looks good"],
      proposals: [
        { kind: "week_plan", summary: notes.slice(0, 4).join("; ") || "Same rhythm as last week.", goals, days: menu.days.map((d) => ({ dayNo: d.dayNo, label: d.label, breakfast: d.slots.find((x) => x.slot === "breakfast")!.recipes, snack: d.slots.find((x) => x.slot === "snack")!.recipes, dinner: d.slots.find((x) => x.slot === "dinner")!.recipes })) },
        { kind: "set_goal", week: "next", goal: goals[0] },
      ],
    };
  }
  return { reply: "I couldn't reach the AI coach just now. You can still tell me a drink to switch to (\"I'd like to drink alkaline water\") or something to avoid (\"no onion\").", quick: ["I'd like to drink alkaline water"], proposals: [] };
}

// ---------------------------------------------------------------- validation + previews
type Validated = { status: "pending" | "blocked"; blockedReason: string | null; payload: Record<string, unknown>; preview: Record<string, unknown>; drop?: boolean };
const incomplete = (): Validated => ({ status: "blocked", blockedReason: null, payload: {}, preview: {}, drop: true });
const blocked = (reason: string, payload: object, preview: object): Validated => ({ status: "blocked", blockedReason: reason, payload: payload as Record<string, unknown>, preview: preview as Record<string, unknown> });
const pending = (payload: object, preview: object): Validated => ({ status: "pending", blockedReason: null, payload: payload as Record<string, unknown>, preview: preview as Record<string, unknown> });

/** The week a proposal targets: "current" = plan covering today; "next" = the following week (must exist). */
async function targetWeek(user: User, week: "current" | "next" | undefined): Promise<UserPlan | null> {
  const plans = await userPlans(user.id);
  const today = toIst().date;
  const cur = planForDate(plans, today)?.plan ?? plans[0];
  if (week === "next") return plans.find((p) => cur && p.startDate > cur.startDate) ?? null;
  return cur ?? null;
}

function remainingDayNos(plan: UserPlan): number[] {
  const today = toIst().date;
  const out: number[] = [];
  for (let d = 1; d <= plan.lengthDays; d++) if (addDays(plan.startDate, d - 1) >= today) out.push(d);
  return out;
}

export async function validateProposal(user: User, p: ProposalInT): Promise<Validated> {
  const rules = await getPersonalisations(user.id);
  const base = await allRecipes();
  const recipes = personaliseAll(base, rules, user.strictCapsicum);
  const opts = { strictCapsicum: user.strictCapsicum };
  const win = { start: hm(user.eatingWindowStart), end: hm(user.eatingWindowEnd) };

  switch (p.kind) {
    case "substitute_ingredient": {
      const from = (p.from ?? "").trim().toLowerCase(), to = (p.to ?? "").trim().toLowerCase();
      const title = `Use ${to} instead of ${from}`;
      if (!from || !to) return incomplete();
      const v = scanText(to, opts);
      if (v.length) return blocked(`${v[0].humanMessage} So I can't swap it in.`, p, { title });
      const scope = p.recipes?.length ? p.recipes.filter((slug) => recipes.has(slug)) : "all";
      const rule: Personalisation = { kind: "substitute", from, to, recipes: scope };
      const diffs: RecipeDiff[] = [];
      for (const r of recipes.values()) {
        if (scope !== "all" && !scope.includes(r.slug)) continue;
        const after = personaliseRecipe(r, [rule])!;
        const d = diffRecipe(r, after);
        if (!d) continue;
        const val = validateRecipe(after, opts);
        if (!val.ok) return blocked(`${after.titleEn}: ${val.violations[0].humanMessage}`, p, { title });
        diffs.push(d);
      }
      if (!diffs.length) return blocked(`None of your recipes use "${from}" in a way I can swap.`, p, { title });
      return pending({ kind: p.kind, rule, reason: p.reason }, { title, reason: p.reason, recipes: diffs.slice(0, 8).map((d) => ({ title: d.title, changes: d.changes.slice(0, 3) })), more: Math.max(0, diffs.length - 8) });
    }

    case "avoid_ingredient": {
      const ing = (p.ingredient ?? "").trim().toLowerCase();
      const title = `Avoid ${ing}`;
      if (!ing) return incomplete();
      const banned = scanText(ing, opts);
      if (banned.length) return blocked(`${ing} is already off your plan.`, p, { title });
      const rule: Personalisation = { kind: "avoid", ingredient: ing };
      const after = personaliseAll(base, [...rules, rule], user.strictCapsicum);
      const replacements: { week: number; dayNo: number; slot: string; from: string; to: string; toSlug: string; fromSlug: string }[] = [];
      for (const plan of [await targetWeek(user, "current"), await targetWeek(user, "next")].filter(Boolean) as UserPlan[]) {
        const menu = plan.menu ?? defaultWeekMenu();
        for (const d of menu.days) {
          if (!remainingDayNos(plan).includes(d.dayNo)) continue;
          for (const sl of d.slots) {
            for (const slug of sl.recipes) {
              const r = recipes.get(slug);
              if (!r || !needsIngredient(r, ing)) continue;
              const alt = bestReplacement(r, sl.slot, after, sl.recipes);
              if (alt) replacements.push({ week: plan.weekNo, dayNo: d.dayNo, slot: sl.slot, from: r.titleEn, fromSlug: slug, to: alt.titleEn, toSlug: alt.slug });
            }
          }
        }
      }
      const affected = [...recipes.values()].filter((r) => needsIngredient(r, ing)).length;
      return pending({ kind: p.kind, rule, replacements, reason: p.reason }, { title, reason: p.reason, replacements: replacements.slice(0, 10), more: Math.max(0, replacements.length - 10), hiddenRecipes: affected });
    }

    case "hydration_drink": {
      const name = (p.drink ?? "").trim().toLowerCase();
      const title = `Track ${name} in your daily glasses`;
      if (!name) return incomplete();
      if (!/(water|green tea|black coffee)/.test(name) || scanText(name, opts).length) return blocked("Outside the eating window only plain water, green tea or black coffee count, so the tracker can only use one of those (alkaline or mineral water is fine).", p, { title });
      return pending({ kind: p.kind, rule: { kind: "hydration_drink", name } }, { title, reason: "Your water counter and reminders will say this instead." });
    }

    case "swap_meal": {
      const plan = await targetWeek(user, p.week);
      const r = p.recipe ? recipes.get(p.recipe) : undefined;
      const slot = p.slot as MealSlot | undefined;
      const title = `Swap ${slot ? SLOT_LABEL[slot].toLowerCase() : "a meal"}${r ? ` to ${r.titleEn}` : ""}`;
      if (!plan) return blocked("Next week isn't planned yet. Let's plan it first.", p, { title });
      if (!slot || !p.recipe) return incomplete();
      if (!r) return blocked("I couldn't find that recipe in your plan-safe list.", p, { title });
      if (r.needsDoctorOk || r.status !== "approved" || !validateRecipe(r, opts).ok) return blocked(`${r.titleEn} needs your nutritionist's OK before it can go in the plan.`, p, { title });
      if (!slotFitsRecipe(r, slot) || r.addedFatTsp > 1) return blocked(`${r.titleEn} doesn't fit the ${SLOT_LABEL[slot].toLowerCase()} slot.`, p, { title });
      const menu = plan.menu ?? defaultWeekMenu();
      const days = (p.dayNos?.length ? p.dayNos : remainingDayNos(plan)).filter((d) => remainingDayNos(plan).includes(d));
      if (!days.length) return blocked("Those days have already passed.", p, { title });
      const changes = days.map((d) => ({ dayNo: d, date: addDays(plan.startDate, d - 1), from: (menu.days[d - 1]?.slots.find((x) => x.slot === slot)?.recipes ?? []).map((x) => recipes.get(x)?.titleEn ?? x).join(" + "), to: r.titleEn }));
      return pending({ kind: p.kind, planId: plan.id, slot, recipe: r.slug, dayNos: days, reason: p.reason }, { title, reason: p.reason, week: plan.weekNo, changes });
    }

    case "set_meal_time": {
      const plan = await targetWeek(user, p.week);
      const slot = p.slot as MealSlot | undefined;
      const time = p.time ?? "";
      const title = `Move ${slot ? SLOT_LABEL[slot].toLowerCase() : "meal"} to ${time}`;
      if (!slot || !/^\d{2}:\d{2}$/.test(time)) return incomplete();
      if (!plan) return blocked("Next week isn't planned yet. Let's plan it first.", p, { title });
      const t = hm(time);
      if (slot === "wake") {
        if (t < hm("05:00") || t > hm("09:00")) return blocked("Wake reminders run between 5 and 9 AM.", p, { title });
      } else if (t < win.start || t + 25 > win.end) {
        return blocked(`${time} is outside your eating window (${user.eatingWindowStart}–${user.eatingWindowEnd}). Changing the window is a decision for your doctor.`, p, { title });
      }
      const menu = plan.menu ?? defaultWeekMenu();
      const days = (p.dayNos?.length ? p.dayNos : remainingDayNos(plan)).filter((d) => remainingDayNos(plan).includes(d));
      for (const d of days) {
        const food = menu.days[d - 1].slots.filter((x) => x.slot !== "wake").map((x) => (x.slot === slot ? t : hm(x.time))).sort((a, b) => a - b);
        if (slot !== "wake" && !food.every((v, k) => k === 0 || (v - food[k - 1] >= 150 && v - food[k - 1] <= 300))) return blocked(`At ${time} the gap to your other meals would be under 2.5 h or over 5 h. Try another time.`, p, { title });
      }
      return pending({ kind: p.kind, planId: plan.id, slot, time, dayNos: days, reason: p.reason }, { title, reason: p.reason, week: plan.weekNo, days });
    }

    case "set_goal": {
      const plan = await targetWeek(user, p.week);
      const goal = (p.goal ?? "").trim();
      const title = `Goal${p.week === "next" ? " for next week" : ""}: ${goal}`;
      if (!goal) return incomplete();
      return pending({ kind: p.kind, planId: plan?.id ?? null, week: p.week ?? "current", goal }, { title });
    }

    case "set_units": {
      const units: UnitPref = { solid: p.solid ?? "g", liquid: p.liquid ?? (p.solid && p.solid !== "original" ? "ml" : "original"), spoons: p.spoons ?? "keep" };
      const label = (u: UnitPref) => [u.solid === "original" ? "cups" : u.solid, u.liquid === "original" ? "cups" : u.liquid].filter((x, i, a) => a.indexOf(x) === i).join(" + ") + (u.spoons === "metric" ? ", spoons too" : "");
      const title = `Show quantities in ${label(units)}`;
      const cur = activeUnits(rules);
      if (cur.solid === units.solid && cur.liquid === units.liquid && cur.spoons === units.spoons) return blocked("That's already how quantities are shown.", p, { title });
      const cf = (await portionContext(user, toIst().date, rules)).factor;
      const examples = sampleChanges(base, rules, user.strictCapsicum, { units, factor: cf, beforeFactor: cf });
      return pending({ kind: p.kind, rule: { kind: "units", units } }, { title, reason: units.solid === "mg" ? "Milligrams make kitchen amounts very large numbers (1 cup of dal ≈ 200,000 mg), but you'll see exactly that everywhere." : "Applies to recipes, prep reminders and cooking steps everywhere in the app.", recipes: examples });
    }

    case "set_calorie_target": {
      const kcal = p.kcal ?? 0;
      const scope = p.scope ?? "ongoing";
      const today = toIst().date;
      const title = `${kcal.toLocaleString("en-IN")} kcal ${scope === "today" ? "today" : "every day"}`;
      if (!kcal) return incomplete();
      if (kcal < KCAL_MIN || kcal > KCAL_MAX) return blocked(`${kcal} kcal is outside the ${KCAL_MIN}–${KCAL_MAX} range EZ FOOD can plan safely. Please set a target with your doctor or nutritionist first.`, p, { title });
      const plans = await userPlans(user.id);
      const slots = slotsForDate(plans, today) ?? [];
      const baseKcal = plannedKcal(recipes, slots.flatMap((x) => x.recipeSlugs));
      const { factor, clamped } = calorieFactor(baseKcal, kcal);
      const units = activeUnits(rules);
      const current = await portionContext(user, today, rules);
      const examples = sampleChanges(base, rules, user.strictCapsicum, { units, factor, beforeFactor: current.factor, slugs: slots.filter((x) => x.slot !== "wake").flatMap((x) => x.recipeSlugs) });
      const reached = Math.round(baseKcal * factor);
      return pending(
        { kind: p.kind, rule: { kind: "calorie_target", kcal, ...(scope === "today" ? { date: today } : {}) }, reason: p.reason },
        {
          title,
          reason: `Today's menu as written is ≈ ${baseKcal} kcal. Food portions × ${factor.toFixed(2)} → ≈ ${reached} kcal${clamped ? ` (portions are capped at ${factor < 1 ? "half" : "2.5×"}, so it lands short of ${kcal})` : ""}. Added fat stays ≤ 1 tsp per meal; spices unchanged. Numbers are estimates; worth confirming the target with your nutritionist.`,
          recipes: examples,
        },
      );
    }

    case "remember_note": {
      const note = (p.note ?? "").trim();
      if (!note) return incomplete();
      return pending({ kind: p.kind, note }, { title: `Remember: ${note}` });
    }

    case "week_plan": {
      const plans = await userPlans(user.id);
      const latest = plans[plans.length - 1];
      const today = toIst();
      const afterLatest = latest ? addDays(planEnd(latest), 1) : today.date;
      const earliest = today.minutes >= hm(user.eatingWindowEnd) ? addDays(today.date, 1) : today.date;
      const start = afterLatest > earliest ? afterLatest : earliest;
      const menu: WeekMenu = {
        days: (p.days ?? []).map((d) => ({
          dayNo: d.dayNo,
          // Weekday names from the model can't be trusted (it doesn't know the start date); keep themed labels only.
          label: d.label && !/(mon|tues|wednes|thurs|fri|satur|sun)day/i.test(d.label) && !/^day\s*\d+$/i.test(d.label) ? d.label : undefined,
          slots: [
            { slot: "wake", time: user.learnedWakeTime, recipes: ["morning-flush"] },
            { slot: "breakfast", time: d.breakfastTime ?? "12:00", recipes: d.breakfast },
            { slot: "snack", time: d.snackTime ?? "16:00", recipes: d.snack },
            { slot: "dinner", time: d.dinnerTime ?? "19:30", recipes: d.dinner },
          ],
        })),
      };
      const check = checkWeekMenu(menu, recipes, win, opts);
      const days = check.repaired.days.map((d) => ({
        dayNo: d.dayNo,
        date: addDays(start, d.dayNo - 1),
        label: d.label,
        slots: d.slots.filter((x) => x.slot !== "wake").map((x) => ({ slot: x.slot, time: x.time, titles: x.recipes.map((r) => recipes.get(r)?.titleEn ?? r) })),
      }));
      return pending(
        { kind: p.kind, start, menu: check.repaired, goals: p.goals ?? [], summary: p.summary ?? "" },
        { title: `Your next 7 days · ${start} → ${addDays(start, 6)}`, summary: p.summary, goals: p.goals ?? [], start, days, repairs: check.repairs.slice(0, 6) },
      );
    }
  }
}

/** Before → after lines for a few plan recipes under new units / portions (for the confirm card). */
function sampleChanges(base: Recipe[], rules: Personalisation[], strict: boolean, o: { units?: UnitPref; factor?: number; slugs?: string[]; beforeFactor?: number }): RecipeDiff[] {
  // Both sides start from the un-portioned recipe (substitutions/avoids only), so nothing is converted twice.
  const raw = new Map<string, Recipe>();
  for (const r of base) {
    const p = personaliseRecipe(r, rules);
    if (p) raw.set(r.slug, p);
  }
  const slugs = o.slugs?.length ? o.slugs : ["green-moong-chilla", "yellow-moong-dal", "papaya-walnuts", "palak-khichdi"];
  const out: RecipeDiff[] = [];
  for (const slug of slugs) {
    const r0 = raw.get(slug);
    if (!r0) continue;
    const b = portionRecipe(r0, { units: activeUnits(rules), factor: o.beforeFactor ?? 1 });
    const a = portionRecipe(r0, { units: o.units ?? activeUnits(rules), factor: o.factor ?? 1 });
    const changes: { before: string; after: string }[] = [];
    const line = (i: { qty?: number; unit?: string; name: string; note?: string }) => `${i.qty ?? ""} ${i.unit ?? ""} ${i.name}${i.note && /≈/.test(i.note) ? ` (${i.note.match(/≈[^,]*/)![0]})` : ""}`.replace(/\s+/g, " ").trim();
    b.ingredients.forEach((ing, k) => {
      const x = a.ingredients[k];
      if (x && line(x) !== line(ing)) changes.push({ before: line(ing), after: line(x) });
    });
    if (b.leadTask && a.leadTask && a.leadTask.instruction !== b.leadTask.instruction) changes.push({ before: b.leadTask.instruction, after: a.leadTask.instruction });
    if (changes.length) out.push({ slug, title: b.titleEn, changes: changes.slice(0, 4) });
    if (out.length >= 4) break;
  }
  return out;
}

function bestReplacement(r: Recipe, slot: MealSlot, pool: Map<string, Recipe>, siblings: string[]): Recipe | null {
  let best: { r: Recipe; s: number } | null = null;
  for (const c of pool.values()) {
    if (c.slug === r.slug || siblings.includes(c.slug) || c.status !== "approved" || c.needsDoctorOk) continue;
    if (!slotFitsRecipe(c, slot)) continue;
    if (c.addedFatTsp > r.addedFatTsp + 0.001 && c.addedFatTsp > 0.5) continue; // keep the meal's fat total within the cap
    const overlap = c.tasteTags.filter((t) => r.tasteTags.includes(t)).length;
    const s = overlap * 2 - Math.abs(c.activeMinutes - r.activeMinutes) / 10 + (c.origin === "plan" ? 0.5 : 0);
    if (!best || s > best.s) best = { r: c, s };
  }
  return best?.r ?? null;
}

// ---------------------------------------------------------------- confirm / reject
export async function decideProposal(user: User, id: string, action: "confirm" | "reject") {
  const db = await getDb();
  const [p] = await db.select().from(s.planProposals).where(and(eq(s.planProposals.id, id), eq(s.planProposals.userId, user.id))).limit(1);
  if (!p) throw new Error("Proposal not found");
  if (p.status !== "pending") return getThread(user, p.thread as Thread);
  const thread = p.thread as Thread;
  if (action === "reject") {
    await db.update(s.planProposals).set({ status: "rejected", decidedAt: new Date() }).where(eq(s.planProposals.id, id));
    await logEvent(user, "coach_proposal_rejected", { entityId: id, payload: { kind: p.kind } });
    await db.insert(s.chatMessages).values({ userId: user.id, thread, role: "assistant", content: "No problem, I've left that as it is. Want to try something else?" });
    return getThread(user, thread);
  }
  const payload = p.payload as Record<string, unknown>;
  const done = await apply(user, p.kind, payload);
  await db.update(s.planProposals).set({ status: "confirmed", decidedAt: new Date() }).where(eq(s.planProposals.id, id));
  await db.update(s.users).set({ profileVersion: user.profileVersion + 1 }).where(eq(s.users.id, user.id));
  await logEvent(user, "coach_proposal_confirmed", { entityId: id, payload: { kind: p.kind } });
  await db.insert(s.chatMessages).values({ userId: user.id, thread, role: "assistant", content: done });
  return getThread(user, thread);
}

async function saveMenu(planId: string, menu: WeekMenu) {
  const db = await getDb();
  await db.update(s.userPlans).set({ menu }).where(eq(s.userPlans.id, planId));
}

/** Drop not-yet-started scheduled meals (and their pending prep) from `fromDate` so they regenerate from the new menu. */
async function regenerateFrom(user: User, fromDate: string) {
  const db = await getDb();
  const now = toIst();
  const rows = await db.select().from(s.scheduledMeals).where(and(eq(s.scheduledMeals.userId, user.id), gte(s.scheduledMeals.date, fromDate), eq(s.scheduledMeals.status, "planned")));
  const drop = rows.filter((m) => m.date > now.date || m.plannedStart > now.minutes);
  if (drop.length) await db.delete(s.scheduledMeals).where(inArray(s.scheduledMeals.id, drop.map((m) => m.id)));
  await db.delete(s.prepTasks).where(and(eq(s.prepTasks.userId, user.id), eq(s.prepTasks.status, "pending"), gte(s.prepTasks.mealDate, fromDate)));
}

async function apply(user: User, kind: string, payload: Record<string, unknown>): Promise<string> {
  const db = await getDb();
  const today = toIst().date;
  switch (kind) {
    case "set_units":
    case "set_calorie_target": {
      const rule = payload.rule as Personalisation;
      // One active rule per kind (a day-only calorie target replaces only that day's).
      const old = await db.select().from(s.personalisations).where(and(eq(s.personalisations.userId, user.id), eq(s.personalisations.kind, rule.kind), eq(s.personalisations.active, true)));
      const same = old.filter((o) => rule.kind !== "calorie_target" || (o.payload as { date?: string }).date === (rule as { date?: string }).date);
      if (same.length) await db.update(s.personalisations).set({ active: false }).where(inArray(s.personalisations.id, same.map((o) => o.id)));
      await db.insert(s.personalisations).values({ userId: user.id, kind: rule.kind, payload: rule });
      await regenerateFrom(user, today);
      return rule.kind === "units" ? "Done. Recipes, prep reminders and cooking steps now show your units." : `Done. Portions now aim for ${(rule as { kcal: number }).kcal} kcal ${(rule as { date?: string }).date ? "today" : "every day"}. Open any recipe to see the new amounts.`;
    }
    case "substitute_ingredient":
    case "hydration_drink": {
      const rule = payload.rule as Personalisation;
      await db.insert(s.personalisations).values({ userId: user.id, kind: rule.kind, payload: rule });
      await regenerateFrom(user, today);
      return rule.kind === "hydration_drink" ? `Done. Your daily counter now tracks ${rule.name}.` : `Done. Your recipes now use ${(rule as { to: string }).to} instead of ${(rule as { from: string }).from}.`;
    }
    case "avoid_ingredient": {
      const rule = payload.rule as Personalisation;
      await db.insert(s.personalisations).values({ userId: user.id, kind: "avoid", payload: rule });
      const reps = (payload.replacements as { week: number; dayNo: number; slot: MealSlot; fromSlug: string; toSlug: string }[]) ?? [];
      for (const plan of await userPlans(user.id)) {
        const mine = reps.filter((r) => r.week === plan.weekNo);
        if (!mine.length) continue;
        const menu = structuredClone(plan.menu ?? defaultWeekMenu());
        for (const r of mine) {
          const sl = menu.days[r.dayNo - 1]?.slots.find((x) => x.slot === r.slot);
          if (sl) sl.recipes = sl.recipes.map((x) => (x === r.fromSlug ? r.toSlug : x));
        }
        await saveMenu(plan.id, menu);
      }
      await regenerateFrom(user, today);
      return `Done. ${(rule as { ingredient: string }).ingredient} is off your list${reps.length ? ` and ${reps.length} meal${reps.length > 1 ? "s were" : " was"} replaced` : ""}.`;
    }
    case "swap_meal":
    case "set_meal_time": {
      const plan = (await userPlans(user.id)).find((p) => p.id === payload.planId);
      if (!plan) return "That week no longer exists, so nothing changed.";
      const menu = structuredClone(plan.menu ?? defaultWeekMenu());
      for (const d of payload.dayNos as number[]) {
        const sl = menu.days[d - 1]?.slots.find((x) => x.slot === payload.slot);
        if (!sl) continue;
        if (kind === "swap_meal") sl.recipes = [payload.recipe as string];
        else sl.time = payload.time as string;
      }
      await saveMenu(plan.id, menu);
      if (kind === "set_meal_time" && payload.slot === "wake") await db.update(s.users).set({ learnedWakeTime: payload.time as string }).where(eq(s.users.id, user.id));
      await regenerateFrom(user, plan.startDate > today ? plan.startDate : today);
      return kind === "swap_meal" ? "Done. Your plan is updated." : `Done. ${SLOT_LABEL[payload.slot as MealSlot]} is now at ${payload.time}.`;
    }
    case "set_goal": {
      const plans = await userPlans(user.id);
      const cur = planForDate(plans, today)?.plan ?? plans[0];
      const plan = payload.week === "next" ? plans.find((p) => p.startDate > cur.startDate) : cur;
      if (!plan) {
        await remember(user, `Goal for next week: ${payload.goal}`, "preference");
        return "Noted. I'll attach that goal to next week as soon as it's planned.";
      }
      await db.update(s.userPlans).set({ goals: [...new Set([...plan.goals, payload.goal as string])] }).where(eq(s.userPlans.id, plan.id));
      return `Done. Week ${plan.weekNo} goal: ${payload.goal}.`;
    }
    case "remember_note":
      await remember(user, payload.note as string, "preference");
      return "Saved. I'll keep that in mind for suggestions.";
    case "week_plan": {
      const plans = await userPlans(user.id);
      const latest = plans[plans.length - 1];
      const start = payload.start as string;
      // If a later week already exists from an earlier confirm, replace it.
      const clash = plans.filter((p) => p.startDate >= start);
      if (clash.length) await db.update(s.userPlans).set({ status: "replaced", endedAt: new Date() }).where(inArray(s.userPlans.id, clash.map((p) => p.id)));
      const weekNo = (clash.length ? Math.min(...clash.map((p) => p.weekNo)) : (latest?.weekNo ?? 0) + 1);
      const goals = [...new Set([...(payload.goals as string[]), ...(await pendingGoalMemories(user))])].slice(0, 4);
      await db.insert(s.userPlans).values({ userId: user.id, planSlug: "coach-week", startDate: start, weekNo, lengthDays: 7, menu: payload.menu as WeekMenu, goals, summary: (payload.summary as string) || null });
      await db.update(s.planProposals).set({ status: "superseded" }).where(and(eq(s.planProposals.userId, user.id), eq(s.planProposals.kind, "week_plan"), eq(s.planProposals.status, "pending")));
      await regenerateFrom(user, start);
      return `Done. Week ${weekNo} starts ${start}. You'll see it on Today and in Plan. Your XP, level and chain carry over.`;
    }
  }
  return "Done.";
}

async function pendingGoalMemories(user: User): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ t: s.memoryChunks.text }).from(s.memoryChunks).where(eq(s.memoryChunks.userId, user.id));
  return rows.map((r) => r.t).filter((t) => t.startsWith("Goal for next week: ")).map((t) => t.slice(20));
}

export async function removePersonalisation(user: User, id: string) {
  const db = await getDb();
  await db.update(s.personalisations).set({ active: false }).where(and(eq(s.personalisations.id, id), eq(s.personalisations.userId, user.id)));
  await regenerateFrom(user, toIst().date);
  await logEvent(user, "personalisation_removed", { entityId: id });
  return { ok: true };
}

