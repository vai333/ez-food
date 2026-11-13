import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { scanText, validateRecipe } from "@/lib/safety/validate";
import { BANNED } from "@/lib/safety/ontology";
import { PLAN_RECIPES } from "@/lib/seed/plan";
import { CURATED_RECIPES } from "@/lib/seed/curated-recipes";
import type { Recipe } from "@/lib/types";

const base: Recipe = { ...CURATED_RECIPES[0], slug: "t", titleEn: "Test bowl", description: "", ingredients: [{ name: "cucumber" }], steps: [{ text: "Mix." }], addedFatTsp: 0 };
const withIng = (name: string): Recipe => ({ ...base, ingredients: [{ name }] });

describe("seed recipes", () => {
  it.each([...PLAN_RECIPES, ...CURATED_RECIPES].map((r) => [r.slug, r] as const))("%s passes the validator", (_s, r) => {
    expect(validateRecipe(r).violations).toEqual([]);
  });
  it("has at least 40 curated alternatives", () => expect(CURATED_RECIPES.length).toBeGreaterThanOrEqual(40));
  it("slugs are unique", () => {
    const all = [...PLAN_RECIPES, ...CURATED_RECIPES].map((r) => r.slug);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("banned aliases", () => {
  const all = BANNED.flatMap((b) => b.aliases.map((a) => [b.canonical, a] as const));
  it.each(all)("%s alias '%s' fails as an ingredient", (_c, alias) => {
    expect(validateRecipe(withIng(alias)).ok).toBe(false);
  });
  it.each(["Tomato", "ALOO", "Baingan bharta", "Shimla Mirch", "green chillies", "Red Chilli Powder", "kashmiri mirch", "garam masala", "deep-fried", "fresh cream", "Butter", "dalda", "coconut milk", "potato starch", "tomato ketchup"])("catches '%s' case-insensitively", (n) => {
    expect(validateRecipe(withIng(n)).ok).toBe(false);
  });
  it("catches banned items hidden in step text", () => {
    expect(validateRecipe({ ...base, steps: [{ text: "Add a pinch of chilli flakes at the end." }] }).ok).toBe(false);
    expect(validateRecipe({ ...base, steps: [{ text: "Fry the pakora until golden." }] }).ok).toBe(false);
  });
  it("allows safe look-alikes", () => {
    for (const n of ["black pepper", "freshly ground black pepper", "sweet potato", "buttermilk", "creamy curd", "peppercorns", "chilli-free chaat spice", "coconut water"]) {
      expect(validateRecipe(withIng(n)).violations, n).toEqual([]);
    }
  });
  it("negations are not uses, but a negation can't hide a second item", () => {
    expect(validateRecipe({ ...base, description: "No tomatoes, no red chillies, no onion-heavy gravy." }).ok).toBe(true);
    expect(validateRecipe({ ...base, description: "no tomato potato curry" }).ok).toBe(false);
    expect(validateRecipe({ ...base, description: "Without oil, deep fry the samosa" }).ok).toBe(false);
  });
  it("chillies are allowed only when strict capsicum is off", () => {
    expect(validateRecipe(withIng("green chilli"), { strictCapsicum: false }).ok).toBe(true);
    expect(validateRecipe(withIng("tomato"), { strictCapsicum: false }).ok).toBe(false);
  });
  it("fails closed on ambiguous blends", () => {
    const v = validateRecipe(withIng("store-bought masala"));
    expect(v.ok).toBe(false);
    expect(v.violations[0].rule).toBe("ambiguous");
  });
});

describe("structure & fat", () => {
  it("rejects > 1 tsp added fat", () => expect(validateRecipe({ ...base, addedFatTsp: 1.5 }).violations.map((v) => v.rule)).toContain("fat_cap"));
  it("accepts exactly 1 tsp", () => expect(validateRecipe({ ...base, addedFatTsp: 1 }).ok).toBe(true));
  it("rejects no ingredients / no steps", () => {
    expect(validateRecipe({ ...base, ingredients: [] }).ok).toBe(false);
    expect(validateRecipe({ ...base, steps: [] }).ok).toBe(false);
  });
  it("rejects invalid timers", () => {
    expect(validateRecipe({ ...base, steps: [{ text: "Wait", durationSeconds: -5 }] }).ok).toBe(false);
    expect(validateRecipe({ ...base, steps: [{ text: "Wait", durationSeconds: 99999 }] }).ok).toBe(false);
  });
  it("wake slot only allows fasting-safe drinks", () => {
    expect(validateRecipe({ ...base, mealTypes: ["wake"], ingredients: [{ name: "dates" }] }).ok).toBe(false);
  });
});

describe("property: any recipe containing a banned alias fails", () => {
  const aliases = BANNED.flatMap((b) => b.aliases);
  const safeWords = ["moong", "lauki", "cumin", "ginger", "curd", "lemon", "spinach", "rice", "jowar", "cucumber", "carrot", "papaya"];
  it("ingredient position", () => {
    fc.assert(
      fc.property(fc.constantFrom(...aliases), fc.array(fc.constantFrom(...safeWords), { maxLength: 4 }), fc.array(fc.constantFrom(...safeWords), { maxLength: 4 }), (alias, pre, post) => {
        const name = [...pre, alias, ...post].join(" ");
        return !validateRecipe(withIng(name)).ok;
      }),
      { numRuns: 500 },
    );
  });
  it("step position, any casing", () => {
    fc.assert(
      fc.property(fc.constantFrom(...aliases), fc.boolean(), (alias, upper) => {
        const text = `Then add ${upper ? alias.toUpperCase() : alias} and stir.`;
        return !validateRecipe({ ...base, steps: [{ text }] }).ok;
      }),
      { numRuns: 300 },
    );
  });
  it("text made only of safe words always passes", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...safeWords), { minLength: 1, maxLength: 8 }), (ws) => scanText(ws.join(" ")).length === 0), { numRuns: 300 });
  });
});
