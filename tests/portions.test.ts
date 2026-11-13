import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PLAN_RECIPES } from "@/lib/seed/plan";
import { CURATED_RECIPES } from "@/lib/seed/curated-recipes";
import { calorieFactor, densityFor, parseNum, portionIngredient, portionRecipe, portionText, toBase, KCAL_MAX, type UnitPref } from "@/lib/engine/portions";
import { activeUnits, calorieTargetFor } from "@/lib/engine/personalise";
import { validateRecipe } from "@/lib/safety/validate";

const R = new Map([...PLAN_RECIPES, ...CURATED_RECIPES].map((r) => [r.slug, r]));
const G: UnitPref = { solid: "g", liquid: "ml", spoons: "keep" };

describe("units", () => {
  it("cups → grams for the soak instruction", () => {
    expect(portionText("Soak 1 cup whole green moong dal (overnight).", { units: G })).toBe("Soak 200 g whole green moong dal (overnight).");
  });
  it("liquids → ml, fractions handled", () => {
    expect(portionText("boil with 1.5 cups water", { units: G })).toBe("boil with 360 ml water");
    expect(portionText("Soak ¼ cup moong dal + ¼ cup brown rice", { units: G })).toBe("Soak 50 g moong dal + 45 g brown rice");
    expect(parseNum("1½")).toBe(1.5);
    expect(parseNum("3/4")).toBe(0.75);
  });
  it("never touches times or counts of whistles", () => {
    const t = "Soak for 4 hours, then pressure cook (about 4 whistles) for 20 minutes.";
    expect(portionText(t, { units: G, factor: 2 })).toBe(t);
  });
  it("milligrams and kilograms work", () => {
    expect(portionText("Soak 1 cup whole green moong dal", { units: { solid: "mg", liquid: "ml", spoons: "keep" } })).toBe("Soak 200000 mg whole green moong dal");
    expect(portionIngredient({ name: "brown rice", qty: 1, unit: "cup" }, { units: { solid: "kg", liquid: "l", spoons: "keep" } })).toMatchObject({ qty: 0.185, unit: "kg" });
  });
  it("spoons stay unless asked for metric", () => {
    expect(portionIngredient({ name: "cumin seeds", qty: 1, unit: "tsp" }, { units: G })).toMatchObject({ qty: 1, unit: "tsp" });
    expect(portionIngredient({ name: "cumin seeds", qty: 1, unit: "tsp" }, { units: { ...G, spoons: "metric" } })).toMatchObject({ qty: 2, unit: "g" });
  });
  it("counts stay counts with a weight hint", () => {
    expect(portionText("Soak 4 walnuts in water", { units: G })).toBe("Soak 4 walnuts (≈ 20 g) in water");
    expect(portionIngredient({ name: "cucumber", qty: 1, unit: "medium" }, { units: G }).note).toMatch(/≈ 200 g/);
  });
  it("original units = untouched", () => {
    const r = R.get("green-moong-chilla")!;
    expect(portionRecipe(r, {})).toBe(r);
  });
  it("density lookup prefers specific items", () => {
    expect(densityFor("roasted chana")!.cup).toBe(140);
    expect(densityFor("kala chana")!.cup).toBe(190);
    expect(densityFor("sprouted green moong")!.cup).toBe(105);
    expect(toBase(1, "glass", "water")).toEqual({ amount: 250, kind: "ml" });
  });
});

describe("calorie portions", () => {
  it("factor = target / planned, clamped to 0.5–2.5", () => {
    expect(calorieFactor(1000, 2200)).toEqual({ factor: 2.2, clamped: false });
    expect(calorieFactor(800, 2200)).toEqual({ factor: 2.5, clamped: true });
    expect(calorieFactor(2000, 600)).toEqual({ factor: 0.5, clamped: true });
  });
  it("scales food, never added fat, never spices", () => {
    const r = portionRecipe(R.get("yellow-moong-dal")!, { units: G, factor: 2 });
    expect(r.ingredients.find((i) => /moong/.test(i.name))).toMatchObject({ qty: 205, unit: "g" });
    expect(r.ingredients.find((i) => /ghee/.test(i.name))).toMatchObject({ qty: 0.5, unit: "tsp" });
    expect(r.ingredients.find((i) => /cumin/.test(i.name))).toMatchObject({ qty: 0.5, unit: "tsp" });
    expect(r.addedFatTsp).toBe(0.5);
    expect(r.nutrition!.kcal).toBe(400);
  });
  it("cooking water grows with the dal; drinking water does not", () => {
    expect(portionRecipe(R.get("yellow-moong-dal")!, { units: G, factor: 2 }).steps[0].text).toMatch(/720 ml water/);
    expect(portionRecipe(R.get("morning-flush")!, { units: G, factor: 2 }).ingredients[0]).toMatchObject({ qty: 240, unit: "ml" });
  });
  it("prep tasks follow portions: 2200 kcal day → bigger soak", () => {
    const r = portionRecipe(R.get("green-moong-chilla")!, { units: G, factor: 2.17 });
    expect(r.leadTask!.instruction).toMatch(/^Soak 435 g whole green moong dal/);
  });
  it("property: any factor and units keep every recipe valid and fat ≤ 1 tsp", () => {
    const units: UnitPref[] = [G, { solid: "mg", liquid: "l", spoons: "metric" }, { solid: "oz", liquid: "cup", spoons: "keep" }, { solid: "original", liquid: "original", spoons: "keep" }];
    fc.assert(
      fc.property(fc.constantFrom(...R.values()), fc.double({ min: 0.5, max: 2.5, noNaN: true }), fc.constantFrom(...units), (r, factor, u) => {
        const out = portionRecipe(r, { units: u, factor });
        return validateRecipe(out).ok && out.addedFatTsp <= 1 && out.ingredients.every((i) => i.qty === undefined || (Number.isFinite(i.qty) && i.qty > 0));
      }),
      { numRuns: 400 },
    );
  });
});

describe("rules", () => {
  it("latest unit preference wins", () => {
    expect(activeUnits([{ kind: "units", units: G }, { kind: "units", units: { solid: "mg", liquid: "ml", spoons: "keep" } }]).solid).toBe("mg");
  });
  it("day-only calorie target beats the ongoing one, only on that day", () => {
    const rules = [{ kind: "calorie_target" as const, kcal: 1800 }, { kind: "calorie_target" as const, kcal: 2200, date: "2026-11-14" }];
    expect(calorieTargetFor(rules, "2026-11-14")).toBe(2200);
    expect(calorieTargetFor(rules, "2026-11-15")).toBe(1800);
    expect(calorieTargetFor([], "2026-11-15")).toBeNull();
    expect(KCAL_MAX).toBe(3500);
  });
});
