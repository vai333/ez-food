import { describe, expect, it } from "vitest";
import { buildPrepTasks } from "@/lib/engine/prep";
import { PLAN_RECIPES } from "@/lib/seed/plan";
import { hm, addDays } from "@/lib/time";

const recipes = new Map(PLAN_RECIPES.map((r) => [r.slug, r]));
const D1 = "2026-11-16";
const days = (n: number) => Array.from({ length: n }, (_, i) => addDays(D1, i));

describe("prep pipeline", () => {
  it("plan started the evening before: Day 1 chilla soak due 21:00 the night before", () => {
    const t = buildPrepTasks({ planStart: D1, dates: days(2), recipes, now: { date: addDays(D1, -1), minutes: hm("18:00") } });
    const soak = t.find((x) => x.recipeSlug === "green-moong-chilla" && x.mealDate === D1)!;
    expect(soak.dateDue).toBe(addDays(D1, -1));
    expect(soak.timeDue).toBe(hm("21:00"));
    expect(soak.late).toBeFalsy();
  });
  it("Day 2 sprout salad: soak task two evenings before Day 2 (= evening before Day 1)", () => {
    const t = buildPrepTasks({ planStart: D1, dates: days(2), recipes, now: { date: addDays(D1, -1), minutes: hm("18:00") } });
    const sprout = t.find((x) => x.recipeSlug === "sprouted-moong-salad" && x.taskType === "sprout")!;
    expect(sprout.mealDate).toBe(addDays(D1, 1));
    expect(sprout.dateDue).toBe(addDays(D1, -1));
    expect(t.some((x) => x.taskType === "rinse" && x.recipeSlug === "sprouted-moong-salad")).toBe(true);
  });
  it("plan starts Day 1 at 07:00: chilla soak moves to a same-morning hot-water soak", () => {
    const t = buildPrepTasks({ planStart: D1, dates: [D1], recipes, now: { date: D1, minutes: hm("07:00") } });
    const soak = t.find((x) => x.recipeSlug === "green-moong-chilla")!;
    expect(soak.dateDue).toBe(D1);
    expect(soak.late).toBeFalsy();
    expect(soak.instruction).toMatch(/hot water/);
  });
  it("plan starts Day 1 at 10:30: chilla soak is late with an honest recovery", () => {
    const t = buildPrepTasks({ planStart: D1, dates: [D1], recipes, now: { date: D1, minutes: hm("10:30") } });
    const soak = t.find((x) => x.recipeSlug === "green-moong-chilla")!;
    expect(soak.late).toBe(true);
    expect(soak.recovery).toMatch(/no-soak|later/);
  });
  it("plan starts Day 1 at 10:30: Day 2 sprouts are still created (late, soak now)", () => {
    const t = buildPrepTasks({ planStart: D1, dates: days(2), recipes, now: { date: D1, minutes: hm("10:30") } });
    const sprout = t.find((x) => x.taskType === "sprout")!;
    expect(sprout.late).toBe(true);
    expect(sprout.dateDue).toBe(D1);
  });
  it("walnut soaks for snacks are scheduled the evening before", () => {
    const t = buildPrepTasks({ planStart: D1, dates: days(2), recipes, now: { date: addDays(D1, -1), minutes: hm("09:00") } });
    expect(t.filter((x) => x.recipeSlug === "papaya-walnuts").length).toBe(1);
    expect(t.filter((x) => x.recipeSlug === "spiced-buttermilk-walnuts").length).toBe(1);
  });
  it("palak khichdi short soak is same-day, before dinner", () => {
    const t = buildPrepTasks({ planStart: D1, dates: days(2), recipes, now: { date: D1, minutes: hm("12:00") } });
    const k = t.find((x) => x.recipeSlug === "palak-khichdi")!;
    expect(k.dateDue).toBe(addDays(D1, 1));
    expect(k.timeDue).toBeLessThan(hm("19:30") - 30);
  });
  it("no tasks for meals that already started today", () => {
    const t = buildPrepTasks({ planStart: D1, dates: [D1], recipes, now: { date: D1, minutes: hm("22:00") } });
    expect(t).toEqual([]);
  });
  it("keys are stable (dedupe)", () => {
    const a = buildPrepTasks({ planStart: D1, dates: days(3), recipes, now: { date: D1, minutes: hm("08:00") } });
    const b = buildPrepTasks({ planStart: D1, dates: days(3), recipes, now: { date: D1, minutes: hm("08:00") } });
    expect(a.map((x) => x.key)).toEqual(b.map((x) => x.key));
    expect(new Set(a.map((x) => x.key)).size).toBe(a.length);
  });
});
