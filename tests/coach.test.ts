import { describe, expect, it } from "vitest";
import { PLAN_RECIPES } from "@/lib/seed/plan";
import { CURATED_RECIPES } from "@/lib/seed/curated-recipes";
import { applySubstitution, diffRecipe, hydrationDrink, needsIngredient, personaliseRecipe, replaceWord } from "@/lib/engine/personalise";
import { checkWeekMenu, defaultWeekMenu, planForDate, slotsForDate, type WeekMenu } from "@/lib/engine/plan";
import { planNextWeek } from "@/lib/engine/weekplanner";
import { buildPrepTasks } from "@/lib/engine/prep";
import { validateRecipe } from "@/lib/safety/validate";
import { ProposalIn, lintCoachReply } from "@/lib/ai/coach";
import { hm } from "@/lib/time";

const all = [...PLAN_RECIPES, ...CURATED_RECIPES];
const R = new Map(all.map((r) => [r.slug, r]));
const flush = R.get("morning-flush")!;
const W = { start: hm("12:00"), end: hm("20:00") };

describe("personalisation", () => {
  it("water → alkaline water in the ginger drink, case-preserving, validator still passes", () => {
    const out = applySubstitution(flush, "water", "alkaline water");
    expect(out.ingredients[0].name).toBe("warm alkaline water");
    expect(out.steps[0].text).toMatch(/warm alkaline water/);
    expect(out.titleEn).toBe("Warm Ginger-Turmeric Alkaline Water");
    expect(validateRecipe(out).ok).toBe(true);
    expect(diffRecipe(flush, out)!.changes.length).toBeGreaterThan(0);
  });
  it("doesn't double-apply", () => {
    expect(replaceWord("warm alkaline water", "water", "alkaline water")).toBe("warm alkaline water");
  });
  it("only whole words", () => {
    expect(replaceWord("watermelon and water", "water", "alkaline water")).toBe("watermelon and alkaline water");
  });
  it("scoped substitution leaves other recipes alone", () => {
    const rule = { kind: "substitute" as const, from: "water", to: "alkaline water", recipes: ["morning-flush"] };
    expect(personaliseRecipe(R.get("yellow-moong-dal")!, [rule])!.steps[0].text).not.toMatch(/alkaline/);
    expect(personaliseRecipe(flush, [rule])!.ingredients[0].name).toMatch(/alkaline/);
  });
  it("a substitution can't smuggle in a banned food (validator catches it)", () => {
    const out = applySubstitution(R.get("lauki-sabzi")!, "lauki", "potato");
    expect(validateRecipe(out).ok).toBe(false);
  });
  it("avoid drops recipes that need it and strips optional uses", () => {
    expect(needsIngredient(R.get("cucumber-raita")!, "cucumber")).toBe(true);
    expect(personaliseRecipe(R.get("cucumber-raita")!, [{ kind: "avoid", ingredient: "cucumber" }])).toBeNull();
    const sticks = R.get("cucumber-sticks")!;
    const p = personaliseRecipe(sticks, [{ kind: "avoid", ingredient: "lemon" }])!;
    expect(p.ingredients.some((i) => /lemon/.test(i.name))).toBe(false);
  });
  it("hydration drink: latest rule wins", () => {
    expect(hydrationDrink([])).toBe("water");
    expect(hydrationDrink([{ kind: "hydration_drink", name: "water" }, { kind: "hydration_drink", name: "alkaline water" }])).toBe("alkaline water");
  });
});

describe("multi-week plans", () => {
  const w1 = { startDate: "2026-11-13", weekNo: 1, lengthDays: 7, menu: null };
  const custom: WeekMenu = defaultWeekMenu();
  custom.days[0].slots[2].recipes = ["roasted-chana-pepper-ginger-salad"];
  const w2 = { startDate: "2026-11-20", weekNo: 2, lengthDays: 7, menu: custom };
  it("resolves the week covering a date", () => {
    expect(planForDate([w1, w2], "2026-11-12")).toBeNull();
    expect(planForDate([w1, w2], "2026-11-19")!.plan.weekNo).toBe(1);
    expect(planForDate([w1, w2], "2026-11-20")).toMatchObject({ dayNo: 1, beyondEnd: false });
    expect(planForDate([w1, w2], "2026-11-20")!.plan.weekNo).toBe(2);
    expect(planForDate([w1], "2026-11-21")).toMatchObject({ dayNo: 9, beyondEnd: true });
  });
  it("week 2 serves its own menu; beyond the last week it repeats", () => {
    expect(slotsForDate([w1, w2], "2026-11-20")!.find((s) => s.slot === "snack")!.recipeSlugs).toEqual(["roasted-chana-pepper-ginger-salad"]);
    expect(slotsForDate([w1, w2], "2026-11-27")!.find((s) => s.slot === "snack")!.recipeSlugs).toEqual(["roasted-chana-pepper-ginger-salad"]);
  });
  it("prep follows the week covering each date", () => {
    const t = buildPrepTasks({ slotsFor: (d) => slotsForDate([w1, w2], d), dates: ["2026-11-20"], recipes: R, now: { date: "2026-11-19", minutes: hm("18:00") } });
    expect(t.some((x) => x.recipeSlug === "green-moong-chilla")).toBe(true);
  });
});

describe("week plan safety check", () => {
  it("the default week passes untouched", () => {
    const c = checkWeekMenu(defaultWeekMenu(), R, W);
    expect(c.repairs).toEqual([]);
  });
  it("repairs unknown, unsafe, wrong-slot, doctor-gated, over-fat and out-of-window items", () => {
    const m = defaultWeekMenu();
    m.days[0].slots[1].recipes = ["aloo-paratha"]; // unknown
    m.days[1].slots[2].recipes = ["morning-flush"]; // wake drink in snack slot
    m.days[2].slots[2].recipes = ["banana-curd-cinnamon"]; // needs doctor OK
    m.days[3].slots[3].recipes = ["palak-khichdi", "lauki-sabzi"]; // 1.5 tsp fat
    m.days[4].slots[3].time = "21:00"; // after window
    const c = checkWeekMenu(m, R, W);
    expect(c.repairs.length).toBeGreaterThanOrEqual(5);
    const d = c.repaired.days;
    expect(d[0].slots[1].recipes).toEqual(["green-moong-chilla", "cucumber-sticks"]);
    expect(d[1].slots[2].recipes).toEqual(["spiced-buttermilk-walnuts"]);
    expect(d[3].slots[3].recipes).toEqual(["palak-khichdi", "cucumber-raita"]);
    expect(d[4].slots[3].time).toBe("19:30");
    for (const day of d) for (const s of day.slots) for (const slug of s.recipes) expect(validateRecipe(R.get(slug)!).ok).toBe(true);
  });
  it("fixes broken meal gaps", () => {
    const m = defaultWeekMenu();
    m.days[0].slots[2].time = "12:30";
    const c = checkWeekMenu(m, R, W);
    expect(c.repaired.days[0].slots[2].time).toBe("16:00");
  });
  it("fills missing days from the original plan", () => {
    const c = checkWeekMenu({ days: defaultWeekMenu().days.slice(0, 3) }, R, W);
    expect(c.repaired.days).toHaveLength(7);
  });
});

describe("fallback week planner", () => {
  it("'less cooking time' keeps every cooked meal ≤ 12 active minutes where an alternative exists, and stays safe", () => {
    const { menu, notes } = planNextWeek({ recipes: R, goals: ["Less cooking time"], liked: [], disliked: [] });
    expect(notes.length).toBeGreaterThan(0);
    const c = checkWeekMenu(menu, R, W);
    expect(c.repairs).toEqual([]);
    const bf = menu.days[0].slots.find((s) => s.slot === "breakfast")!.recipes.map((x) => R.get(x)!);
    expect(bf.every((r) => r.activeMinutes <= 12)).toBe(true);
  });
  it("'more variety' changes snacks and some dinners", () => {
    const { notes } = planNextWeek({ recipes: R, goals: ["More variety"], liked: [], disliked: [] });
    expect(notes.some((n) => /snack/.test(n))).toBe(true);
    expect(notes.some((n) => /dinner/.test(n))).toBe(true);
  });
  it("respects dislikes", () => {
    const { menu } = planNextWeek({ recipes: R, goals: [], liked: [], disliked: ["lauki-sabzi"] });
    expect(menu.days.flatMap((d) => d.slots.flatMap((s) => s.recipes))).not.toContain("lauki-sabzi");
  });
});

describe("coach proposal schema", () => {
  it("parses a substitution and rejects an unknown kind", () => {
    expect(ProposalIn.safeParse({ kind: "substitute_ingredient", from: "water", to: "alkaline water", recipes: ["morning-flush"] }).success).toBe(true);
    expect(ProposalIn.safeParse({ kind: "change_window", time: "21:00" }).success).toBe(false);
  });
});

describe("coach reply lint", () => {
  it("drops medical-claim sentences and keeps the useful rest", () => {
    const r = lintCoachReply("I understand you miss tomatoes. We keep them out to help your joints heal. Try a squeeze of lemon instead?");
    expect(r.text).toBe("I understand you miss tomatoes. Try a squeeze of lemon instead?");
  });
  it("never lets the coach offer to move the eating window", () => {
    const r = lintCoachReply("9 PM is outside your window. Would you like to adjust your entire eating window to 13:00 to 21:00 instead?");
    expect(r.text).not.toMatch(/13:00/);
    expect(r.text).toMatch(/decision for your doctor/);
  });
  it("leaves clean replies alone", () => {
    const t = "Alkaline water is fine to drink as your daily plain water. Shall I update your drinks?";
    expect(lintCoachReply(t).text).toBe(t);
  });
});
