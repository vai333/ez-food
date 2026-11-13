import { describe, expect, it } from "vitest";
import { detectRedFlags, isMedicationQuestion } from "@/lib/safety/redflags";
import { PRIOR, mean, rng, sampleBeta, thompsonRank, update, backoff } from "@/lib/engine/bandit";
import { retrieve } from "@/lib/engine/retrieve";
import { PLAN_RECIPES } from "@/lib/seed/plan";
import { CURATED_RECIPES } from "@/lib/seed/curated-recipes";
import { INTERVENTIONS } from "@/lib/seed/interventions";
import { BANNED_COPY } from "@/lib/ai/prompts";
import { planNudges, MAX_PER_DAY } from "@/lib/server/notify";
import { fmtHm, hm, istToUtc, toIst } from "@/lib/time";
import { slotsForDay, defaultStartDate } from "@/lib/engine/plan";

describe("red flags", () => {
  it.each(["my eyes look yellow", "Dark urine since morning", "severe stomach pain", "black stool today", "I fainted", "chest pain", "shaky and sweaty and dizzy", "vision is blurry", "I have yellow eyes and belly pain"])("flags: %s", (t) => expect(detectRedFlags(t).flagged).toBe(true));
  it.each(["felt a bit tired", "craving something sweet", "meeting ran late", "joints a little stiff"])("does not flag: %s", (t) => expect(detectRedFlags(t).flagged).toBe(false));
  it("dizziness triggers the fasting valve", () => expect(detectRedFlags("feeling dizzy").fastingDiscomfort).toBe(true));
  it("medication questions are detected", () => {
    expect(isMedicationQuestion("should I stop my methotrexate?")).toBe(true);
    expect(isMedicationQuestion("can I have papaya?")).toBe(false);
  });
});

describe("bandit", () => {
  it("updates", () => {
    const p = update(update(PRIOR, true), false);
    expect(p).toEqual({ alpha: 2, beta: 2, n: 2 });
    expect(mean(update(PRIOR, true))).toBeGreaterThan(0.5);
  });
  it("samples are in 0..1 and deterministic per seed", () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 100; i++) {
      const x = sampleBeta({ alpha: 3, beta: 2, n: 3 }, a);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(x).toBe(sampleBeta({ alpha: 3, beta: 2, n: 3 }, b));
    }
  });
  it("Thompson ranking favours the strong arm most of the time", () => {
    const post = new Map([["a", { alpha: 30, beta: 2, n: 30 }], ["b", { alpha: 2, beta: 30, n: 30 }]]);
    let top = 0;
    const r = rng(7);
    for (let i = 0; i < 500; i++) if (thompsonRank(["a", "b"], (x) => x, post, r, 0.1)[0] === "a") top++;
    expect(top / 500).toBeGreaterThan(0.85);
    expect(top / 500).toBeLessThan(1); // exploration floor
  });
  it("back-off blends toward global when n is small", () => {
    const b = backoff({ alpha: 2, beta: 1, n: 1 }, { alpha: 10, beta: 10, n: 18 });
    expect(mean(b)).toBeLessThan(mean({ alpha: 2, beta: 1, n: 1 }));
  });
});

describe("craving retrieval", () => {
  const all = [...PLAN_RECIPES, ...CURATED_RECIPES];
  const q = { slot: "snack" as const, cravings: ["spicy" as const, "crunchy" as const], nowMinutes: hm("15:30"), windowStart: hm("12:00"), windowEnd: hm("20:00") };
  it("finds ≥ 3 strong matches for spicy + crunchy without any LLM", () => {
    const r = retrieve(all, q, new Map(), rng(1));
    expect(r.filter((x) => x.strong).length).toBeGreaterThanOrEqual(3);
  });
  it("never returns anything outside the window", () => expect(retrieve(all, { ...q, nowMinutes: hm("21:00") }, new Map(), rng(1))).toEqual([]));
  it("skips needs-doctor items by default", () => expect(retrieve(all, { ...q, cravings: ["sweet"] }, new Map(), rng(1)).some((x) => x.recipe.needsDoctorOk)).toBe(false));
  it("respects excludes", () => {
    const first = retrieve(all, q, new Map(), rng(1))[0].recipe.slug;
    expect(retrieve(all, { ...q, excludeSlugs: [first] }, new Map(), rng(1)).some((x) => x.recipe.slug === first)).toBe(false);
  });
});

describe("interventions library", () => {
  it("has 150+ items, none with banned tone words", () => {
    expect(INTERVENTIONS.length).toBeGreaterThanOrEqual(150);
    for (const i of INTERVENTIONS) expect(BANNED_COPY.test(i.text), i.slug).toBe(false);
  });
  it("every health fact has a source", () => {
    for (const i of INTERVENTIONS.filter((x) => x.type === "health_fact")) expect(i.source, i.slug).toBeTruthy();
  });
});

describe("notifications", () => {
  const meals = [
    { slot: "wake", plannedStart: hm("06:45"), status: "planned", title: "Ginger water", activeMinutes: 2 },
    { slot: "breakfast", plannedStart: hm("12:00"), status: "planned", title: "Chilla", activeMinutes: 20 },
    { slot: "snack", plannedStart: hm("16:00"), status: "planned", title: "Papaya", activeMinutes: 3 },
    { slot: "dinner", plannedStart: hm("19:30"), status: "planned", title: "Dal", activeMinutes: 15 },
  ];
  it("caps at 6 per day and respects quiet hours", () => {
    const n = planNudges({ learnedWakeTime: "06:45", eatingWindowEnd: "20:00", notifPrefs: {} }, meals, [{ timeDue: hm("21:00"), instruction: "Soak", key: "k" }]);
    expect(n.length).toBeLessThanOrEqual(MAX_PER_DAY);
    expect(n.every((x) => x.kind === "wake_activation" || (x.minutes >= hm("06:00") && x.minutes < hm("22:00")))).toBe(true);
    expect(n[0].kind).toBe("wake_activation");
  });
  it("honours per-type opt-out and skips logged meals", () => {
    const n = planNudges({ learnedWakeTime: "06:45", eatingWindowEnd: "20:00", notifPrefs: { hydration: false } }, meals.map((m) => (m.slot === "breakfast" ? { ...m, status: "eaten" } : m)), []);
    expect(n.some((x) => x.kind === "hydration")).toBe(false);
    expect(n.some((x) => x.kind === "meal_prep" && x.slot === "breakfast")).toBe(false);
  });
});

describe("time & plan", () => {
  it("IST conversion incl. midnight rollover", () => {
    expect(toIst(new Date("2026-11-13T18:29:00Z"))).toMatchObject({ date: "2026-11-13", minutes: 23 * 60 + 59 });
    expect(toIst(new Date("2026-11-13T18:30:00Z"))).toMatchObject({ date: "2026-11-14", minutes: 0 });
    expect(istToUtc("2026-11-14", 0).toISOString()).toBe("2026-11-13T18:30:00.000Z");
    expect(fmtHm(hm("19:30"))).toBe("19:30");
  });
  it("menu A on odd days, B on even", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => slotsForDay(d).menu).join("")).toBe("ABABABA");
  });
  it("start date defaults to tomorrow after 20:00", () => {
    expect(defaultStartDate("2026-11-13", hm("19:59"))).toBe("2026-11-13");
    expect(defaultStartDate("2026-11-13", hm("20:00"))).toBe("2026-11-14");
  });
});
