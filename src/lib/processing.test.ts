import { describe, expect, it } from "vitest";
import { JOB_KINDS, STEPS, STEPS_BY_KIND, STEP_NAMES } from "./processing";

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
});
