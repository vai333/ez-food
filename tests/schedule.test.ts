import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildDaySchedule, type MealInput } from "@/lib/engine/schedule";
import { hm } from "@/lib/time";

const meals = (p = 25): MealInput[] => [
  { slot: "breakfast", defaultStart: hm("12:00"), prepBuffer: p },
  { slot: "snack", defaultStart: hm("16:00"), prepBuffer: 8 },
  { slot: "dinner", defaultStart: hm("19:30"), prepBuffer: 20 },
];
const W = { windowStart: hm("12:00"), windowEnd: hm("20:00") };
const starts = (r: ReturnType<typeof buildDaySchedule>) => r.meals.map((m) => m.start);

describe("buildDaySchedule", () => {
  it("keeps defaults on a free day", () => {
    const r = buildDaySchedule({ ...W, meals: meals(), busy: [] });
    expect(r.feasible).toBe(true);
    expect(starts(r)).toEqual([hm("12:00"), hm("16:00"), hm("19:30")]);
  });
  it("shifts lunch later when a 12–13 meeting blocks it", () => {
    const r = buildDaySchedule({ ...W, meals: meals(), busy: [{ start: hm("12:00"), end: hm("13:00") }] });
    expect(r.feasible).toBe(true);
    expect(r.meals[0].start).toBeGreaterThanOrEqual(hm("13:10"));
    expect(r.meals[0].shiftMinutes).toBeGreaterThan(0);
  });
  it("shifts dinner earlier when 19:00–20:00 is busy (protects the close)", () => {
    const r = buildDaySchedule({ ...W, meals: meals(), busy: [{ start: hm("19:00"), end: hm("20:00") }] });
    expect(r.feasible).toBe(true);
    expect(r.meals[2].end).toBeLessThanOrEqual(hm("18:50"));
  });
  it("respects prep buffer: a meeting ending at 11:55 pushes a 25-min-prep lunch", () => {
    const r = buildDaySchedule({ ...W, meals: meals(25), busy: [{ start: hm("11:00"), end: hm("11:55") }] });
    expect(r.meals[0].prepStart).toBeGreaterThanOrEqual(hm("12:05"));
  });
  it("never schedules before notBefore", () => {
    const r = buildDaySchedule({ ...W, meals: meals(), busy: [], notBefore: hm("12:40") });
    expect(r.meals[0].start).toBeGreaterThanOrEqual(hm("12:40"));
  });
  it("honours locked meals", () => {
    const m = meals();
    m[0].lockedStart = hm("12:30");
    const r = buildDaySchedule({ ...W, meals: m, busy: [] });
    expect(r.meals[0].start).toBe(hm("12:30"));
  });
  it("returns infeasible with options when the whole afternoon is booked", () => {
    const r = buildDaySchedule({ ...W, meals: meals(), busy: [{ start: hm("12:30"), end: hm("19:00") }] });
    expect(r.feasible).toBe(false);
    if (!r.feasible) {
      expect(r.options.length).toBeGreaterThan(0);
    }
  });
  it("offers no-cook when only the prep buffer causes infeasibility", () => {
    const r = buildDaySchedule({ ...W, meals: meals(60), busy: [{ start: hm("11:00"), end: hm("12:40") }, { start: hm("13:00"), end: hm("17:00") }] });
    expect(r.feasible).toBe(false);
    if (!r.feasible) expect(r.options.length).toBeGreaterThan(0);
  });
  it("back-to-back meetings with a gap still find a slot", () => {
    const r = buildDaySchedule({ ...W, meals: meals(10), busy: [{ start: hm("11:30"), end: hm("12:30") }, { start: hm("13:45"), end: hm("15:00") }] });
    expect(r.feasible).toBe(true);
    expect(r.meals[0].start).toBeGreaterThanOrEqual(hm("12:40"));
  });
  it("deterministic: same input, same output", () => {
    const input = { ...W, meals: meals(), busy: [{ start: hm("15:30"), end: hm("16:30") }] };
    expect(buildDaySchedule(input)).toEqual(buildDaySchedule(input));
  });

  it("property: feasible schedules stay in window, keep gaps 150–300, avoid busy blocks", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: hm("10:00"), max: hm("20:00") }), fc.integer({ min: 15, max: 120 })), { maxLength: 3 }),
        fc.integer({ min: 3, max: 40 }),
        (blocks, prep) => {
          const busy = blocks.map(([s, d]) => ({ start: s, end: s + d }));
          const r = buildDaySchedule({ ...W, meals: meals(prep), busy });
          if (!r.feasible) return true;
          const ms = r.meals;
          for (const m of ms) {
            if (m.start < W.windowStart || m.end > W.windowEnd) return false;
            for (const b of busy) if (m.prepStart < b.end + 10 && b.start - 10 < m.end) return false;
          }
          for (let i = 1; i < ms.length; i++) {
            const g = ms[i].start - ms[i - 1].start;
            if (g < 150 || g > 300) return false;
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });
  it("property: infeasible days always come with at least one option", () => {
    fc.assert(
      fc.property(fc.integer({ min: hm("11:00"), max: hm("18:00") }), fc.integer({ min: 60, max: 480 }), (s, d) => {
        const r = buildDaySchedule({ ...W, meals: meals(), busy: [{ start: s, end: s + d }] });
        return r.feasible || r.options.length > 0;
      }),
      { numRuns: 200 },
    );
  });
  it("property: infeasible results never silently move meals outside the window", () => {
    fc.assert(
      fc.property(fc.integer({ min: hm("12:00"), max: hm("18:00") }), fc.integer({ min: 90, max: 420 }), (s, d) => {
        const r = buildDaySchedule({ ...W, meals: meals(), busy: [{ start: s, end: s + d }] });
        return r.meals.every((m) => m.start >= W.windowStart && m.end <= W.windowEnd);
      }),
      { numRuns: 200 },
    );
  });
});
