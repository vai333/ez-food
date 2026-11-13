import { describe, expect, it } from "vitest";
import { computeChain, levelFor, luckyBowl, questsFor, questProgress, xpForLevel, earnedBadges, type Totals } from "@/lib/game/engine";

const day = (date: string, done: number) => ({ date, slotsDone: done, slotsTotal: 4 });

describe("levels", () => {
  it("thresholds", () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(xpForLevel(5)).name).toBe("Chilla Champion");
    expect(levelFor(1_000_000).name).toMatch(/EZ Legend/);
  });
  it("progress is 0..1", () => {
    for (const x of [0, 50, 150, 999, 5000]) {
      const l = levelFor(x);
      expect(l.progress).toBeGreaterThanOrEqual(0);
      expect(l.progress).toBeLessThan(1);
    }
  });
});

describe("consistency chain", () => {
  it("counts days with ≥ 3 of 4 slots", () => {
    const c = computeChain([day("2026-11-01", 4), day("2026-11-02", 3), day("2026-11-03", 3)], "2026-11-04");
    expect(c.current).toBe(3);
    expect(c.shields).toBe(1);
  });
  it("a shield protects an off day; chain survives", () => {
    const c = computeChain([day("01", 4), day("02", 4), day("03", 4), day("04", 1), day("05", 4)], "06");
    expect(c.days[3].state).toBe("shielded");
    expect(c.current).toBe(4);
    expect(c.shields).toBe(0);
  });
  it("without shields, an off day is a fresh start but best is kept", () => {
    const c = computeChain([day("01", 4), day("02", 4), day("03", 0), day("04", 4)], "05");
    expect(c.days[2].state).toBe("fresh_start");
    expect(c.current).toBe(1);
    expect(c.best).toBe(2);
  });
  it("today is pending, never penalised early", () => {
    const c = computeChain([day("01", 4), day("02", 0)], "02");
    expect(c.days[1].state).toBe("pending");
    expect(c.current).toBe(1);
  });
  it("shields cap at 2", () => {
    const c = computeChain(Array.from({ length: 12 }, (_, i) => day(String(i).padStart(2, "0"), 4)), "99");
    expect(c.shields).toBe(2);
  });
});

describe("quests", () => {
  it("3 per day, deterministic, no duplicate water quests", () => {
    for (let d = 1; d <= 28; d++) {
      const date = `2026-11-${String(d).padStart(2, "0")}`;
      const q = questsFor(date, "u_abc", d);
      expect(q).toHaveLength(3);
      expect(q.filter((x) => x.id.startsWith("hydrate")).length).toBeLessThanOrEqual(1);
      expect(questsFor(date, "u_abc", d).map((x) => x.id)).toEqual(q.map((x) => x.id));
    }
  });
  it("day 1 always includes First sip", () => expect(questsFor("2026-11-16", "u_x", 1).map((q) => q.id)).toContain("sip-first"));
  it("progress caps at goal", () => {
    const q = questsFor("2026-11-16", "u_x", 2).find((x) => x.id.startsWith("hydrate")) ?? questsFor("2026-11-16", "u_x", 2)[0];
    const p = questProgress(q, { date: "", morningAck: true, morningAckMinutes: 400, waterGlasses: 20, mealsDone: 3, onTimeMeals: 3, swaps: 0, prepDone: 1, prepDoneBefore22: 1, checkins: 1, cookCompleted: 1, slotsDone: 4, slotsTotal: 4, reflection: true });
    expect(p.done).toBe(true);
    expect(p.value).toBe(p.goal);
  });
});

describe("lucky bowl", () => {
  it("deterministic and roughly 1 in 5", () => {
    let hits = 0;
    for (let i = 0; i < 5000; i++) if (luckyBowl(`m${i}`) > 0) hits++;
    expect(hits / 5000).toBeGreaterThan(0.15);
    expect(hits / 5000).toBeLessThan(0.25);
    expect(luckyBowl("abc")).toBe(luckyBowl("abc"));
  });
  it("bonus within 5..30", () => {
    for (let i = 0; i < 2000; i++) {
      const v = luckyBowl(`x${i}`);
      if (v) expect(v >= 5 && v <= 30).toBe(true);
    }
  });
});

describe("badges", () => {
  const zero: Totals = { meals: 0, morningAcks: 0, earlyAcks: 0, prepDone: 0, maxWaterDay: 0, cookCompleted: 0, cookedSlugs: [], swaps: 0, emergencies: 0, perfectDays: 0, chainBest: 0, level: 1, questsDone: 0, checkins: 0, luckyBowls: 0, planDaysCounted: 0, reflections: 0 };
  it("none at start", () => expect(earnedBadges(zero)).toEqual([]));
  it("first sip + adapt", () => expect(earnedBadges({ ...zero, morningAcks: 1, swaps: 1 })).toEqual(["first-sip", "adapt"]));
});
