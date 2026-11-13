/** Shared domain types for EZ FOOD. Pure types only: safe to import from client and server. */

export const APP_NAME = "EZ FOOD";
export const APP_TAGLINE = "Eat the plan. Without thinking.";

export type MealSlot = "wake" | "breakfast" | "snack" | "dinner";
export type MealType = MealSlot | "any";

/** Controlled taste vocabulary (build prompt §7). */
export const TASTE_TAGS = [
  "sweet",
  "savory",
  "crunchy",
  "spicy", // pepper / ginger based only: chillies are banned
  "light",
  "heavy",
  "tangy",
  "creamy",
  "warm",
  "cool",
  "comfort",
  "fresh",
] as const;
export type TasteTag = (typeof TASTE_TAGS)[number];

export type RecipeIngredient = {
  /** Free text the validator scans, e.g. "whole green moong dal". */
  name: string;
  qty?: number;
  unit?: string;
  note?: string;
  optional?: boolean;
  /** Pantry key (see lib/food/pantry.ts) used for "what do you have?" matching. */
  pantry?: string;
};

export type RecipeStep = {
  text: string;
  /** Set when the step involves waiting or a timed action; drives cooking-mode timers. */
  durationSeconds?: number;
  timerLabel?: string;
  passive?: boolean;
  tip?: string;
};

export type LeadTask = {
  type: "soak" | "sprout" | "prep_ahead";
  /** Hours before the meal the task must start. */
  hours: number;
  instruction: string;
};

export type Recipe = {
  slug: string;
  titleEn: string;
  titleHi?: string;
  description: string;
  mealTypes: MealType[];
  cuisine: string;
  tasteTags: TasteTag[];
  textureTags: string[];
  temperature: "warm" | "cool" | "room";
  activeMinutes: number;
  passiveMinutes: number;
  leadTask?: LeadTask;
  difficulty: 1 | 2 | 3;
  servings: number;
  addedFatTsp: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  /** One plain sentence, no medical claims. */
  whyGood: string;
  /** Ready in <= 3 minutes with no cooking (Emergency "Quick assemble"). */
  quickAssemble?: boolean;
  /** Grab-and-eat, zero prep (Emergency "Grab a raw snack"). */
  rawGrab?: boolean;
  /** Outside the written plan; only offered inside the eating window and labelled. */
  planAdjacent?: boolean;
  /** Needs the nutritionist's OK before it appears (e.g. banana). */
  needsDoctorOk?: boolean;
  origin: "plan" | "curated" | "ai_generated";
  status: "approved" | "pending_review" | "rejected";
  /** Where durations / nutrition numbers came from. */
  source: "plan" | "estimate";
  nutrition?: { kcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number; source: "estimate" | "IFCT" | "USDA" };
  /** Illustration key in components/art (falls back to a generic bowl). */
  art?: string;
};

export type InterventionType = "quote" | "health_fact" | "implementation_intention" | "reframe" | "tiny_step" | "breathing";
export type Tone = "warm" | "firm" | "playful" | "calm";
export type DeviationType = "skipped" | "late" | "swapped" | "emergency" | "off_plan_item" | "early_break";

export type Intervention = {
  slug: string;
  type: InterventionType;
  tone: Tone;
  text: string;
  /** Empty / missing = any. */
  triggers?: { deviation?: DeviationType[]; slot?: MealSlot[]; timeOfDay?: ("morning" | "midday" | "afternoon" | "evening" | "night")[]; positive?: boolean };
  /** Required for type "health_fact" and for any attributed quote. */
  source?: string;
  attribution?: string;
};

export const REASON_CODES = [
  "no_time",
  "meeting_ran_late",
  "not_hungry",
  "craving_something_else",
  "didnt_like_recipe",
  "no_ingredients",
  "too_tired_to_cook",
  "social_event",
  "travel",
  "stress_emotional",
  "forgot",
  "felt_unwell",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type MealStatus = "planned" | "prepping" | "eaten" | "swapped" | "skipped" | "emergency" | "missed";
