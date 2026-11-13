/**
 * Red-flag symptom detector (build prompt §3.3.5). Conservative: when in doubt, flag.
 * Runs on any free text the user writes (check-in notes, craving notes) on client AND server.
 */
const RED_FLAGS: { key: string; label: string; patterns: RegExp[] }[] = [
  { key: "jaundice", label: "Yellowing of eyes or skin", patterns: [/yellow(ish|ing)?\s+(eyes?|skin)/i, /(eyes?|skin)\s+(look|looks|are|is|turn(ed|ing)?)\s+yellow/i, /jaundice/i, /peeli\s+aankh/i] },
  { key: "dark_urine", label: "Dark urine", patterns: [/dark\s+(urine|pee)/i, /(urine|pee)\s+(is\s+)?(very\s+)?dark/i, /cola[- ]colou?red\s+urine/i] },
  { key: "abdominal_pain", label: "Severe or persistent belly pain", patterns: [/(severe|bad|sharp|terrible|persistent|constant|unbearable)\s+(abdominal|stomach|belly|tummy)\s+pain/i, /(abdominal|stomach|belly|tummy)\s+pain\s+(won'?t|doesn'?t|that won'?t)\s+(go|stop)/i, /pet\s+(mein|me)\s+(bahut|tez)\s+dard/i, /belly pain/i] },
  { key: "gi_bleed", label: "Black or bloody stools / vomiting blood", patterns: [/black\s+(stool|poo|poop)/i, /blood(y)?\s+(in\s+)?(stool|poo|poop|vomit)/i, /vomit(ing|ed)?\s+blood/i, /tarry\s+stool/i] },
  { key: "vomiting", label: "Persistent vomiting", patterns: [/(keep|kept|can'?t stop|persistent|non[- ]?stop)\s+(vomit|throwing up)/i, /vomit(ed|ing)?\s+(\d+|several|many)\s+times/i] },
  { key: "fainting", label: "Fainting or confusion", patterns: [/faint(ed|ing)?/i, /pass(ed)?\s+out/i, /blacked\s+out/i, /confus(ed|ion)/i, /behosh/i] },
  { key: "chest", label: "Chest pain or breathlessness", patterns: [/chest\s+(pain|tight)/i, /(short(ness)?\s+of\s+breath|breathless|can'?t\s+breathe|difficulty\s+breathing)/i] },
  { key: "fever_flare", label: "Fever with a sudden severe flare", patterns: [/(high\s+)?fever.*(flare|joint|rash)/i, /(flare|rash).*fever/i] },
  { key: "eye", label: "Red, painful eye or vision change", patterns: [/(red|painful)\s+eye/i, /eye\s+pain/i, /(blurr?(y|ed)|losing|lost|change\s+in)\s+(vision|eyesight)/i, /(vision|eyesight|eyes?)\s+(is\s+|are\s+|went\s+|going\s+)?(blurr?(y|ed)|dim|cloudy)/i] },
  { key: "skin_pustular", label: "Sudden widespread pustules or peeling skin", patterns: [/pustul/i, /(skin\s+)?peeling\s+(all\s+over|everywhere|off)/i, /widespread\s+(rash|blisters?)/i] },
  { key: "hypo", label: "Shaky, sweaty or faint while fasting", patterns: [/(shaky|shaking|trembling).*(sweat|faint|dizzy)/i, /(sweaty|sweating).*(shaky|faint|dizzy)/i, /low\s+(blood\s+)?sugar/i, /hypo(glycemi[ac])?/i] },
];

/** Milder fasting symptoms: trigger the "it's okay to eat now" safety valve, not the doctor card. */
const FASTING_DISCOMFORT = [/dizz(y|iness)/i, /light[- ]?headed/i, /weak(ness)?/i, /chakkar/i, /shaky/i];

export type RedFlagResult = { flagged: boolean; matches: { key: string; label: string }[]; fastingDiscomfort: boolean };

export function detectRedFlags(text: string): RedFlagResult {
  const matches = RED_FLAGS.filter((f) => f.patterns.some((p) => p.test(text))).map(({ key, label }) => ({ key, label }));
  return { flagged: matches.length > 0, matches, fastingDiscomfort: FASTING_DISCOMFORT.some((p) => p.test(text)) };
}

export const URGENT_CARE_SIGNS = RED_FLAGS.map((f) => f.label);

/** Fixed safe response for medication / supplement questions (never advise). */
export const MEDICATION_REPLY =
  "EZ FOOD can't advise on medicines or supplements: starting, stopping, or timing them. Please ask your prescribing doctor.";

export function isMedicationQuestion(text: string): boolean {
  return /\b(medicine|medication|meds|tablet|pill|dose|dosage|supplement|methotrexate|metformin|insulin|vitamin|capsule|biologic|steroid|prednisolone|injection|stop taking|start taking)\b/i.test(text);
}
