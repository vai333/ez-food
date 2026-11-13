/**
 * Drizzle schema (build prompt §7, trimmed to what the MVP reads and writes; see docs/DECISIONS.md D-03).
 * Every user-owned table has user_id and every query in lib/server/* is scoped by it.
 */
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, real, date, uniqueIndex, index, smallint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  /** Pseudonymous ref sent to the LLM instead of any PII. */
  userRef: text("user_ref").notNull().unique(),
  displayName: text("display_name").notNull().default("Friend"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  eatingWindowStart: text("eating_window_start").notNull().default("12:00"),
  eatingWindowEnd: text("eating_window_end").notNull().default("20:00"),
  wakeWindowStart: text("wake_window_start").notNull().default("06:00"),
  wakeWindowEnd: text("wake_window_end").notNull().default("08:00"),
  learnedWakeTime: text("learned_wake_time").notNull().default("06:45"),
  strictCapsicum: boolean("strict_capsicum").notNull().default(true),
  clinicianAware: boolean("clinician_aware").notNull().default(false),
  clinicianAwareAt: timestamp("clinician_aware_at", { withTimezone: true }),
  disclaimerAckAt: timestamp("disclaimer_ack_at", { withTimezone: true }),
  consentPersonalisation: boolean("consent_personalisation").notNull().default(true),
  learningPaused: boolean("learning_paused").notNull().default(false),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  doctorAllows: jsonb("doctor_allows").$type<string[]>().notNull().default([]),
  dinnerCarb: text("dinner_carb").notNull().default("rice"),
  languagePref: text("language_pref").notNull().default("en"),
  wakeHookTokenHash: text("wake_hook_token_hash"),
  redFlagUntil: timestamp("red_flag_until", { withTimezone: true }),
  notifPrefs: jsonb("notif_prefs").$type<Record<string, boolean>>().notNull().default({}),
  profileVersion: integer("profile_version").notNull().default(1),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
});

export const userPlans = pgTable("user_plans", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planSlug: text("plan_slug").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  /** 1 = the original 7-day plan; 2+ = weeks planned with the coach. */
  weekNo: integer("week_no").notNull().default(1),
  lengthDays: integer("length_days").notNull().default(7),
  /** null = the original Menu A/B plan; otherwise a confirmed WeekMenu (lib/engine/plan.ts). */
  menu: jsonb("menu"),
  goals: jsonb("goals").$type<string[]>().notNull().default([]),
  summary: text("summary"),
  status: text("status").notNull().default("active"),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: created(),
}, (t) => [index("user_plans_user").on(t.userId)]);

export const pantryItems = pgTable("pantry_items", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  inStock: boolean("in_stock").notNull().default(true),
  updatedAt: updated(),
}, (t) => [uniqueIndex("pantry_user_key").on(t.userId, t.key)]);

/** AI-generated and admin-edited recipes. Plan + curated recipes live in code (lib/seed) and are not duplicated here. */
export const recipes = pgTable("recipes", {
  id: id(),
  slug: text("slug").notNull().unique(),
  data: jsonb("data").notNull(),
  origin: text("origin").notNull(),
  status: text("status").notNull().default("pending_review"),
  validator: jsonb("validator"),
  council: jsonb("council"),
  createdByUser: uuid("created_by_user"),
  createdAt: created(),
  updatedAt: updated(),
});

export const scheduledMeals = pgTable("scheduled_meals", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  dayNo: integer("day_no").notNull(),
  slot: text("slot").notNull(),
  plannedRecipes: jsonb("planned_recipes").$type<string[]>().notNull(),
  plannedStart: integer("planned_start").notNull(),
  plannedEnd: integer("planned_end").notNull(),
  status: text("status").notNull().default("planned"),
  actualRecipe: text("actual_recipe"),
  actualAt: timestamp("actual_at", { withTimezone: true }),
  shiftMinutes: integer("shift_minutes").notNull().default(0),
  shiftReason: text("shift_reason"),
  version: integer("version").notNull().default(1),
  updatedAt: updated(),
}, (t) => [uniqueIndex("meal_user_date_slot").on(t.userId, t.date, t.slot)]);

export const busyBlocks = pgTable("busy_blocks", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  start: integer("start").notNull(),
  end: integer("end").notNull(),
  label: text("label").notNull().default("Busy"),
  createdAt: created(),
}, (t) => [index("busy_user_date").on(t.userId, t.date)]);

export const prepTasks = pgTable("prep_tasks", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  dateDue: date("date_due", { mode: "string" }).notNull(),
  timeDue: integer("time_due").notNull(),
  recipeSlug: text("recipe_slug").notNull(),
  mealDate: date("meal_date", { mode: "string" }).notNull(),
  slot: text("slot").notNull(),
  taskType: text("task_type").notNull(),
  instruction: text("instruction").notNull(),
  late: boolean("late").notNull().default(false),
  recovery: text("recovery"),
  status: text("status").notNull().default("pending"),
  doneAt: timestamp("done_at", { withTimezone: true }),
}, (t) => [uniqueIndex("prep_user_key").on(t.userId, t.key)]);

/** Append-only behaviour log (build prompt §7 event taxonomy). */
export const events = pgTable("events", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientEventId: text("client_event_id"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  date: date("date", { mode: "string" }).notNull(),
  type: text("type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("events_user_ts").on(t.userId, t.ts), index("events_user_type").on(t.userId, t.type), uniqueIndex("events_client_id").on(t.userId, t.clientEventId)]);

export const feedback = pgTable("feedback", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  rating: smallint("rating").notNull(),
  reasonCodes: jsonb("reason_codes").$type<string[]>().notNull().default([]),
  freeText: text("free_text"),
  shownContext: jsonb("shown_context").$type<Record<string, unknown>>().notNull().default({}),
});

export const checkins = pgTable("checkins", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  date: date("date", { mode: "string" }).notNull(),
  mealId: uuid("meal_id"),
  kind: text("kind").notNull().default("deviation"), // deviation | reflection | unwell
  deviationType: text("deviation_type"),
  reasonCodes: jsonb("reason_codes").$type<string[]>().notNull().default([]),
  reasonText: text("reason_text"),
  mood: smallint("mood"),
  hunger: smallint("hunger"),
  energy: smallint("energy"),
  jointComfort: smallint("joint_comfort"),
  digestion: smallint("digestion"),
  symptomFlags: jsonb("symptom_flags").$type<string[]>().notNull().default([]),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  interventionShown: text("intervention_shown"),
  interventionHelped: boolean("intervention_helped"),
  redFlag: boolean("red_flag").notNull().default(false),
}, (t) => [index("checkins_user_date").on(t.userId, t.date)]);

/** Beta posteriors for Thompson sampling. key examples: "recipe:roasted-chana-salad", "tone:warm", "nudge:hydration". */
export const preferenceScores = pgTable("preference_scores", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  alpha: real("alpha").notNull().default(1),
  beta: real("beta").notNull().default(1),
  n: integer("n").notNull().default(0),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("pref_user_key").on(t.userId, t.key)]);

export const userInsights = pgTable("user_insights", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekStart: date("week_start", { mode: "string" }).notNull(),
  insightType: text("insight_type").notNull(),
  summary: text("summary").notNull(),
  evidenceCount: integer("evidence_count").notNull().default(0),
  confidence: real("confidence").notNull().default(0.5),
  suggestedAdjustment: text("suggested_adjustment"),
  status: text("status").notNull().default("active"),
  modelGenerated: boolean("model_generated").notNull().default(false),
  userEditedText: text("user_edited_text"),
  createdAt: created(),
}, (t) => [index("insights_user").on(t.userId)]);

/** Personal memory for prompt personalisation. Keyword retrieval in v1; embedding column reserved for pgvector. */
export const memoryChunks = pgTable("memory_chunks", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  kind: text("kind").notNull(),
  weight: real("weight").notNull().default(1),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: created(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const aiCalls = pgTable("ai_calls", {
  id: id(),
  userId: uuid("user_id"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  promptHash: text("prompt_hash").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  cacheHit: boolean("cache_hit").notNull().default(false),
  validatorResult: jsonb("validator_result"),
  fallbackUsed: boolean("fallback_used").notNull().default(false),
  error: text("error"),
  response: jsonb("response"),
}, (t) => [index("ai_calls_hash").on(t.promptHash), index("ai_calls_ts").on(t.ts)]);

export const notificationQueue = pgTable("notification_queue", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<{ title: string; body: string; url: string; action?: string }>().notNull(),
  status: text("status").notNull().default("pending"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [index("notif_due").on(t.status, t.dueAt)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  ua: text("ua"),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  createdAt: created(),
});

/** Gamification ledger. `ref` makes every award idempotent (refreshes / retries can't double-award). */
export const xpLedger = pgTable("xp_ledger", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  date: date("date", { mode: "string" }).notNull(),
  kind: text("kind").notNull(),
  points: integer("points").notNull(),
  ref: text("ref").notNull(),
  label: text("label").notNull(),
}, (t) => [uniqueIndex("xp_user_ref").on(t.userId, t.ref), index("xp_user_date").on(t.userId, t.date)]);

export const achievements = pgTable("achievements", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  badgeId: text("badge_id").notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  seen: boolean("seen").notNull().default(false),
}, (t) => [uniqueIndex("ach_user_badge").on(t.userId, t.badgeId)]);

/** Coach chat. thread: "coach" (any time) or "next_week" (planning the following 7 days). */
export const chatMessages = pgTable("chat_messages", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  thread: text("thread").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  quickReplies: jsonb("quick_replies").$type<string[]>().notNull().default([]),
  createdAt: created(),
}, (t) => [index("chat_user_thread").on(t.userId, t.thread, t.createdAt)]);

/** Every change the coach suggests. Nothing is applied until the user confirms it. */
export const planProposals = pgTable("plan_proposals", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messageId: uuid("message_id"),
  thread: text("thread").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  preview: jsonb("preview").notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed | rejected | blocked | superseded
  blockedReason: text("blocked_reason"),
  createdAt: created(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [index("proposals_user").on(t.userId, t.status)]);

/** Confirmed personal rules applied on top of every recipe: substitutions, avoided ingredients, hydration drink. */
export const personalisations = pgTable("personalisations", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  active: boolean("active").notNull().default(true),
  proposalId: uuid("proposal_id"),
  createdAt: created(),
}, (t) => [index("personal_user").on(t.userId, t.active)]);
