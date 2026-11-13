/**
 * Gamification engine. Pure: the server feeds it aggregated stats from the event log.
 *
 * Design rules (docs/DECISIONS.md D-07):
 * - Reward showing up and adapting, not perfection. A compliant swap or emergency option still earns XP.
 * - The consistency chain is protected by shields; a missed day never shows "streak lost", only "fresh start".
 * - XP never goes down. No leaderboards, no weight or calorie numbers.
 * - Variable rewards (Lucky Bowl) are deterministic per meal so replays and refreshes can't farm them.
 */

export const XP = {
  morning_ack: 15,
  meal_eaten: 25,
  on_time_bonus: 10,
  meal_swapped: 20,
  emergency_choice: 15,
  prep_done: 15,
  water_glass: 2,
  water_cap_glasses: 10,
  checkin: 5,
  cook_completed: 10,
  reflection: 10,
  perfect_day: 50,
} as const;

export type XpKind = keyof typeof XP | "quest" | "lucky_bowl" | "badge" | "weekly_quest";

/** Cheap stable 32-bit hash for deterministic per-ref randomness. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** ~1 in 5 logged meals hides a Lucky Bowl worth 5–30 XP. */
export function luckyBowl(ref: string): number {
  const h = hash32(`lucky:${ref}`);
  if (h % 5 !== 0) return 0;
  return 5 + ((h >>> 8) % 6) * 5;
}

// ---------- Levels ----------
export const LEVEL_NAMES = ["Sprout", "Soaked", "Tadka Apprentice", "Dal Devotee", "Chilla Champion", "Window Keeper", "Pepper Sage", "Kitchen Yogi", "Thali Master", "EZ Legend"];

export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFor(xp: number): { level: number; name: string; floor: number; next: number; progress: number } {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const name = level <= LEVEL_NAMES.length ? LEVEL_NAMES[level - 1] : `EZ Legend ${toRoman(level - LEVEL_NAMES.length + 1)}`;
  return { level, name, floor, next, progress: (xp - floor) / (next - floor) };
}

function toRoman(n: number): string {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

// ---------- Consistency chain ----------
export type DayResult = { date: string; slotsDone: number; slotsTotal: number };
export const dayCounts = (d: DayResult) => d.slotsDone >= Math.min(3, d.slotsTotal);

export type ChainDay = { date: string; state: "counted" | "shielded" | "fresh_start" | "pending" };
export type Chain = { current: number; best: number; shields: number; maxShields: number; days: ChainDay[]; nextShieldIn: number };

/**
 * days: chronological, from plan start through today. Today is "pending" until it counts (never penalised early).
 * Earn 1 shield per 3 counted days (max 2). A non-counted past day spends a shield; with none, the chain restarts.
 */
export function computeChain(days: DayResult[], today: string, maxShields = 2): Chain {
  let current = 0, best = 0, shields = 0, sinceShield = 0;
  const out: ChainDay[] = [];
  for (const d of days) {
    if (dayCounts(d)) {
      current++;
      sinceShield++;
      if (sinceShield >= 3) {
        sinceShield = 0;
        if (shields < maxShields) shields++;
      }
      out.push({ date: d.date, state: "counted" });
    } else if (d.date >= today) {
      out.push({ date: d.date, state: "pending" });
    } else if (shields > 0) {
      shields--;
      out.push({ date: d.date, state: "shielded" });
    } else {
      current = 0;
      sinceShield = 0;
      out.push({ date: d.date, state: "fresh_start" });
    }
    best = Math.max(best, current);
  }
  return { current, best, shields, maxShields, days: out, nextShieldIn: shields >= maxShields ? 0 : 3 - sinceShield };
}

// ---------- Daily quests ----------
export type DayStats = {
  date: string;
  morningAck: boolean;
  morningAckMinutes?: number;
  waterGlasses: number;
  mealsDone: number; // eaten / swapped / emergency, excl. wake
  onTimeMeals: number;
  swaps: number;
  prepDone: number;
  prepDoneBefore22: number;
  checkins: number;
  cookCompleted: number;
  slotsDone: number;
  slotsTotal: number;
  reflection: boolean;
};

export type QuestDef = { id: string; title: string; hint: string; reward: number; target: (s: DayStats) => number; goal: number };

export const QUEST_POOL: QuestDef[] = [
  { id: "hydrate-8", title: "Eight glasses", hint: "Tap +1 every time you finish a glass of water.", reward: 25, goal: 8, target: (s) => s.waterGlasses },
  { id: "hydrate-6", title: "Six glasses by sundown", hint: "Water, green tea or black coffee all count.", reward: 20, goal: 6, target: (s) => s.waterGlasses },
  { id: "sip-first", title: "First sip", hint: "Have your ginger-turmeric water and tap Done.", reward: 20, goal: 1, target: (s) => (s.morningAck ? 1 : 0) },
  { id: "on-time-2", title: "On the dot ×2", hint: "Eat two meals within 30 min of their time.", reward: 30, goal: 2, target: (s) => s.onTimeMeals },
  { id: "all-three", title: "Full house", hint: "Log break-fast, snack and dinner today.", reward: 35, goal: 3, target: (s) => s.mealsDone },
  { id: "chef-mode", title: "Chef mode", hint: "Cook one meal start to finish in Cooking Mode.", reward: 25, goal: 1, target: (s) => s.cookCompleted },
  { id: "prep-tonight", title: "Future-you favour", hint: "Finish a soak or prep task before 10 PM.", reward: 25, goal: 1, target: (s) => s.prepDoneBefore22 },
  { id: "honest-log", title: "Honest log", hint: "Do one 10-second check-in (skips are data, not verdicts).", reward: 15, goal: 1, target: (s) => s.checkins },
  { id: "reflect", title: "Close the day", hint: "Answer tonight's 5-question reflection.", reward: 20, goal: 1, target: (s) => (s.reflection ? 1 : 0) },
  { id: "early-bird", title: "Early bird", hint: "Ginger water before 7:30 AM.", reward: 25, goal: 1, target: (s) => (s.morningAck && (s.morningAckMinutes ?? 9999) <= 450 ? 1 : 0) },
];

/** Three quests per day, chosen deterministically. "First sip" is always offered on day 1. */
export function questsFor(date: string, seed: string, dayNo: number): QuestDef[] {
  const pool = [...QUEST_POOL];
  const picked: QuestDef[] = [];
  if (dayNo === 1) picked.push(pool.splice(pool.findIndex((q) => q.id === "sip-first"), 1)[0]);
  let h = hash32(`${seed}:${date}`);
  while (picked.length < 3 && pool.length) {
    const i = h % pool.length;
    const q = pool.splice(i, 1)[0];
    // never two water quests on the same day
    if (q.id.startsWith("hydrate") && picked.some((p) => p.id.startsWith("hydrate"))) continue;
    picked.push(q);
    h = hash32(`${h}`);
  }
  return picked;
}

export function questProgress(q: QuestDef, s: DayStats) {
  const value = Math.min(q.target(s), q.goal);
  return { id: q.id, title: q.title, hint: q.hint, reward: q.reward, value, goal: q.goal, done: value >= q.goal };
}

// ---------- Badges ----------
export type Totals = {
  meals: number;
  morningAcks: number;
  earlyAcks: number;
  prepDone: number;
  maxWaterDay: number;
  cookCompleted: number;
  cookedSlugs: string[];
  swaps: number;
  emergencies: number;
  perfectDays: number;
  chainBest: number;
  level: number;
  questsDone: number;
  checkins: number;
  luckyBowls: number;
  planDaysCounted: number;
  reflections: number;
};

export type BadgeDef = { id: string; title: string; detail: string; icon: string; tier: "bronze" | "silver" | "gold"; earned: (t: Totals) => boolean };

export const BADGES: BadgeDef[] = [
  { id: "first-sip", title: "First Sip", detail: "Had your first ginger-turmeric water.", icon: "glass", tier: "bronze", earned: (t) => t.morningAcks >= 1 },
  { id: "early-bird", title: "Early Bird", detail: "Ginger water before 7:30 AM, three times.", icon: "sunrise", tier: "silver", earned: (t) => t.earlyAcks >= 3 },
  { id: "first-plate", title: "First Plate", detail: "Logged your first planned meal.", icon: "utensils", tier: "bronze", earned: (t) => t.meals >= 1 },
  { id: "chilla-maker", title: "Chilla Maker", detail: "Cooked the green moong chilla in Cooking Mode.", icon: "chef", tier: "bronze", earned: (t) => t.cookedSlugs.includes("green-moong-chilla") },
  { id: "soak-master", title: "Soak Master", detail: "Finished 5 soak or sprout tasks.", icon: "droplet", tier: "silver", earned: (t) => t.prepDone >= 5 },
  { id: "hydration-hero", title: "Hydration Hero", detail: "Eight glasses in a single day.", icon: "waves", tier: "bronze", earned: (t) => t.maxWaterDay >= 8 },
  { id: "adapt", title: "Adapt, Don't Abandon", detail: "Swapped to a plan-safe alternative instead of skipping.", icon: "shuffle", tier: "bronze", earned: (t) => t.swaps >= 1 },
  { id: "calm-chaos", title: "Calm in Chaos", detail: "Used Emergency Mode and stayed on plan.", icon: "zap", tier: "bronze", earned: (t) => t.emergencies >= 1 },
  { id: "chain-3", title: "Three in a Row", detail: "A 3-day consistency chain.", icon: "link", tier: "bronze", earned: (t) => t.chainBest >= 3 },
  { id: "chain-7", title: "Full Week", detail: "A 7-day consistency chain.", icon: "flame", tier: "gold", earned: (t) => t.chainBest >= 7 },
  { id: "chain-14", title: "Fortnight Flow", detail: "A 14-day consistency chain.", icon: "crown", tier: "gold", earned: (t) => t.chainBest >= 14 },
  { id: "perfect-day", title: "Perfect Day", detail: "All four slots done in one day.", icon: "star", tier: "silver", earned: (t) => t.perfectDays >= 1 },
  { id: "perfect-3", title: "Hat-trick", detail: "Three perfect days.", icon: "sparkles", tier: "gold", earned: (t) => t.perfectDays >= 3 },
  { id: "home-chef", title: "Home Chef", detail: "Finished Cooking Mode 10 times.", icon: "chef", tier: "silver", earned: (t) => t.cookCompleted >= 10 },
  { id: "honest-logger", title: "Honest Logger", detail: "Five check-ins. Every one teaches the app.", icon: "notebook", tier: "silver", earned: (t) => t.checkins >= 5 },
  { id: "quester", title: "Quester", detail: "Completed 10 daily quests.", icon: "target", tier: "silver", earned: (t) => t.questsDone >= 10 },
  { id: "lucky", title: "Lucky Bowl", detail: "Found a hidden Lucky Bowl.", icon: "gift", tier: "bronze", earned: (t) => t.luckyBowls >= 1 },
  { id: "level-5", title: "Chilla Champion", detail: "Reached level 5.", icon: "medal", tier: "silver", earned: (t) => t.level >= 5 },
  { id: "level-10", title: "EZ Legend", detail: "Reached level 10.", icon: "trophy", tier: "gold", earned: (t) => t.level >= 10 },
  { id: "plan-complete", title: "Seven Days Strong", detail: "Seven plan days counted.", icon: "calendar", tier: "gold", earned: (t) => t.planDaysCounted >= 7 },
  { id: "reflector", title: "Reflector", detail: "Three nightly reflections.", icon: "moon", tier: "bronze", earned: (t) => t.reflections >= 3 },
];

export const earnedBadges = (t: Totals) => BADGES.filter((b) => b.earned(t)).map((b) => b.id);
