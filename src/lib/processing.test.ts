import { describe, expect, it } from "vitest";
import {
  JOB_KIND_SLICES,
  JOB_KINDS,
  STEPS,
  STEPS_BY_KIND,
  STEP_NAMES,
  stepsFor,
} from "./processing";

describe("step registry (AC-7)", () => {
  it("lists the steps per kind in the spec's order", () => {
    expect(STEPS_BY_KIND.initial).toEqual([
      "trim",
      "transcript",
      "background",
      "ai_edit",
      "render",
    ]);
    expect(STEPS_BY_KIND.rerender).toEqual(["background", "render"]);
    expect(STEPS_BY_KIND.reanalyse).toEqual(["ai_edit", "render"]);
  });

  it("has a step list for every job kind, using only known step names", () => {
    for (const kind of JOB_KINDS) {
      expect(STEPS_BY_KIND[kind].length).toBeGreaterThan(0);
      for (const step of STEPS_BY_KIND[kind]) expect(STEP_NAMES).toContain(step);
    }
  });

  it("makes only trim and render live in slice 1", () => {
    const live = STEP_NAMES.filter((name) => STEPS[name].slice <= 1);
    expect(live).toEqual(["trim", "render"]);
  });

  it("defines every job kind from the spec, with reanalyse live from slice 5", () => {
    expect(JOB_KINDS).toEqual(["initial", "rerender", "reanalyse"]);
    expect(JOB_KIND_SLICES.reanalyse).toBe(5);
  });

  it("creates only live steps, and a re render's background only when it changed", () => {
    expect(stepsFor("initial")).toEqual(["trim", "render"]);
    expect(stepsFor("rerender")).toEqual(["render"]);
    expect(stepsFor("initial", { liveSlice: 5 })).toEqual(STEPS_BY_KIND.initial);
    expect(stepsFor("rerender", { liveSlice: 3 })).toEqual(["render"]);
    expect(stepsFor("rerender", { liveSlice: 3, backgroundChanged: true })).toEqual([
      "background",
      "render",
    ]);
    expect(stepsFor("reanalyse", { liveSlice: 5 })).toEqual(["ai_edit", "render"]);
  });
});
