/**
 * Scheduling engine (build prompt §9.4). Pure and deterministic: same input, same output.
 * Works in minutes since IST midnight. The wake drink is not a calorie event and is not scheduled here.
 */
import type { MealSlot } from "../types";

export type Block = { start: number; end: number };

export type MealInput = {
  slot: Exclude<MealSlot, "wake">;
  defaultStart: number;
  /** Minutes of hands-on cooking before the meal (recipe active minutes + 5). */
  prepBuffer: number;
  durationToEat?: number;
  /** Already eaten / user-pinned: keep exactly here. */
  lockedStart?: number;
};

export type ScheduleInput = {
  meals: MealInput[];
  windowStart: number;
  windowEnd: number;
  busy: Block[];
  minGap?: number;
  maxGap?: number;
  travelBuffer?: number;
  /** Do not place an unlocked meal before this minute (e.g. "now"). */
  notBefore?: number;
};

export type ScheduledMealOut = { slot: MealInput["slot"]; start: number; end: number; shiftMinutes: number; prepStart: number };

export type ScheduleResult =
  | { feasible: true; meals: ScheduledMealOut[] }
  | { feasible: false; meals: ScheduledMealOut[]; options: InfeasibleOption[]; reason: string };

export type InfeasibleOption =
  | { kind: "compress"; label: string; meals: ScheduledMealOut[] }
  | { kind: "no_cook"; label: string; meals: ScheduledMealOut[] }
  | { kind: "extend_window"; label: string; meals: ScheduledMealOut[]; extendBy: number };

const STEP = 5;
const DEFAULT_EAT = 25;

function overlaps(a: Block, b: Block): boolean {
  return a.start < b.end && b.start < a.end;
}

function blockFree(start: number, m: MealInput, busy: Block[], travel: number): boolean {
  const eat = m.durationToEat ?? DEFAULT_EAT;
  const need: Block = { start: start - m.prepBuffer, end: start + eat };
  return !busy.some((b) => overlaps(need, { start: b.start - travel, end: b.end + travel }));
}

/** Cost of moving a meal: later shifts are cheaper for the first meal, earlier for the last (protects window close). */
function shiftCost(delta: number, idx: number, count: number): number {
  const a = Math.abs(delta);
  if (idx === 0) return delta >= 0 ? a : a * 1.5;
  if (idx === count - 1) return delta <= 0 ? a : a * 1.5;
  return a;
}

function solve(input: Required<Omit<ScheduleInput, "notBefore">> & { notBefore?: number }): ScheduledMealOut[] | null {
  const { meals, windowStart, windowEnd, busy, minGap, maxGap, travelBuffer } = input;
  const n = meals.length;
  const candidates: number[][] = meals.map((m, idx) => {
    if (m.lockedStart !== undefined) return [m.lockedStart];
    const eat = m.durationToEat ?? DEFAULT_EAT;
    const lo = Math.max(windowStart, input.notBefore !== undefined ? Math.ceil(input.notBefore / STEP) * STEP : windowStart);
    const hi = windowEnd - eat;
    const out: number[] = [];
    for (let t = lo; t <= hi; t += STEP) if (blockFree(t, m, busy, travelBuffer)) out.push(t);
    return out.sort((x, y) => shiftCost(x - m.defaultStart, idx, n) - shiftCost(y - m.defaultStart, idx, n) || x - y);
  });

  let best: number[] | null = null;
  let bestCost = Infinity;
  const cur: number[] = [];
  const dfs = (i: number, cost: number) => {
    if (cost >= bestCost) return;
    if (i === n) {
      best = [...cur];
      bestCost = cost;
      return;
    }
    for (const t of candidates[i]) {
      if (i > 0) {
        const gap = t - cur[i - 1];
        if (gap < minGap || gap > maxGap) continue;
      }
      const c = meals[i].lockedStart !== undefined ? 0 : shiftCost(t - meals[i].defaultStart, i, n);
      if (cost + c >= bestCost) break; // candidates are sorted by cost
      cur.push(t);
      dfs(i + 1, cost + c);
      cur.pop();
    }
  };
  dfs(0, 0);
  if (!best) return null;
  const chosen: number[] = best;
  return meals.map((m, i) => ({
    slot: m.slot,
    start: chosen[i],
    end: chosen[i] + (m.durationToEat ?? DEFAULT_EAT),
    shiftMinutes: chosen[i] - m.defaultStart,
    prepStart: chosen[i] - m.prepBuffer,
  }));
}

export function buildDaySchedule(input: ScheduleInput): ScheduleResult {
  const full = { minGap: 150, maxGap: 300, travelBuffer: 10, ...input };
  const meals = [...full.meals].sort((a, b) => a.defaultStart - b.defaultStart);
  const ok = solve({ ...full, meals });
  if (ok) return { feasible: true, meals: ok };

  const fallback: ScheduledMealOut[] = meals.map((m) => ({ slot: m.slot, start: m.lockedStart ?? m.defaultStart, end: (m.lockedStart ?? m.defaultStart) + (m.durationToEat ?? DEFAULT_EAT), shiftMinutes: 0, prepStart: (m.lockedStart ?? m.defaultStart) - m.prepBuffer }));
  const options: InfeasibleOption[] = [];

  // (b) No-cook: swap affected meals to quick-assemble recipes (prep 5 min).
  const noCook = solve({ ...full, meals: meals.map((m) => ({ ...m, prepBuffer: Math.min(m.prepBuffer, 5) })) });
  if (noCook) options.push({ kind: "no_cook", label: "Switch to no-cook options so the day still fits", meals: noCook });

  // (a) Compress to two meals: fold the snack into break-fast.
  const two = meals.filter((m) => m.slot !== "snack");
  if (two.length < meals.length) {
    const comp = solve({ ...full, meals: two, maxGap: 480 });
    if (comp) options.push({ kind: "compress", label: "Two meals today: have the snack with break-fast", meals: comp });
  }

  // (c) Extend the window by up to 30 min, only with explicit confirmation.
  for (const ext of [15, 30]) {
    const e = solve({ ...full, meals, windowEnd: full.windowEnd + ext });
    if (e) {
      options.push({ kind: "extend_window", label: `Extend tonight's window by ${ext} min (check with your doctor first)`, meals: e, extendBy: ext });
      break;
    }
  }

  // Last resort: quick-assemble food eaten at the desk (ignores busy blocks, keeps the window and gaps).
  if (!options.length) {
    const desk = solve({ ...full, busy: [], meals: meals.map((m) => ({ ...m, prepBuffer: 5 })) });
    if (desk) options.push({ kind: "no_cook", label: "Eat a 3-minute no-cook option at your desk", meals: desk });
  }

  return { feasible: false, meals: fallback, options, reason: "Your meetings leave no slot that keeps the gaps and the 8 PM close." };
}
