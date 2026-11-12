import { describe, expect, it } from "vitest";
import { isFailureCode } from "./failure-codes";
import {
  EMAIL_JOB_KINDS,
  JOB_KIND_SLICES,
  JOB_KINDS,
  LIVE_SLICE,
  SKIP_REASONS,
  STEPS,
  STEPS_BY_KIND,
  STEP_NAMES,
  isSkipReason,
  isTranscribeKind,
  jobKindSendsEmail,
  stepsFor,
} from "./processing";

describe("step registry (AC-7)", () => {
  it("lists the steps per kind in the spec's order", () => {
    // Spec 0007: `transcript` left the initial job and became its own job kind.
    expect(STEPS_BY_KIND.initial).toEqual(["trim", "background", "ai_edit", "render"]);
    expect(STEPS_BY_KIND.rerender).toEqual(["background", "render"]);
    expect(STEPS_BY_KIND.transcribe).toEqual(["transcript"]);
    expect(STEPS_BY_KIND.reanalyse).toEqual(["ai_edit", "render"]);
  });

  it("has a step list for every job kind, using only known step names", () => {
    for (const kind of JOB_KINDS) {
      expect(STEPS_BY_KIND[kind].length).toBeGreaterThan(0);
      for (const step of STEPS_BY_KIND[kind]) expect(STEP_NAMES).toContain(step);
    }
  });

  it("makes only trim and render live in slice 1, and adds transcript in slice 2", () => {
    expect(STEP_NAMES.filter((name) => STEPS[name].slice <= 1)).toEqual(["trim", "render"]);
    expect(STEP_NAMES.filter((name) => STEPS[name].slice <= 2)).toEqual([
      "trim",
      "transcript",
      "render",
    ]);
    expect(STEP_NAMES.filter((name) => STEPS[name].slice <= 3)).toEqual([
      "trim",
      "transcript",
      "background",
      "render",
    ]);
    expect(LIVE_SLICE).toBe(3);
  });

  it("defines every job kind from the spec: transcribe live from slice 2, reanalyse from slice 5", () => {
    expect(JOB_KINDS).toEqual(["initial", "rerender", "transcribe", "reanalyse"]);
    expect(JOB_KIND_SLICES.transcribe).toBe(2);
    expect(JOB_KIND_SLICES.reanalyse).toBe(5);
  });

  it("emails only the first run: transcribe and re render jobs never send the take email", () => {
    expect(EMAIL_JOB_KINDS).toEqual(["initial"]);
    expect(jobKindSendsEmail("initial")).toBe(true);
    expect(jobKindSendsEmail("rerender")).toBe(false);
    expect(jobKindSendsEmail("transcribe")).toBe(false);
    expect(jobKindSendsEmail("something_new")).toBe(false);
    expect(isTranscribeKind("transcribe")).toBe(true);
    expect(isTranscribeKind("initial")).toBe(false);
  });

  it("holds the skip reasons, separate from failure codes", () => {
    expect(SKIP_REASONS).toEqual(["not_english", "no_speech", "original_gone", "no_green_screen"]);
    expect(isSkipReason("no_speech")).toBe(true);
    expect(isSkipReason("provider_error")).toBe(false);
    for (const reason of SKIP_REASONS) expect(isFailureCode(reason)).toBe(false);
  });

  it("creates only live steps, and the background step only for a job with a background", () => {
    expect(stepsFor("initial")).toEqual(["trim", "render"]);
    expect(stepsFor("initial", { hasBackground: true })).toEqual(["trim", "background", "render"]);
    expect(stepsFor("rerender")).toEqual(["render"]);
    expect(stepsFor("rerender", { hasBackground: true })).toEqual(["background", "render"]);
    expect(stepsFor("transcribe")).toEqual(["transcript"]);
    expect(stepsFor("transcribe", { liveSlice: 1 })).toEqual([]);
    expect(stepsFor("initial", { liveSlice: 2, hasBackground: true })).toEqual(["trim", "render"]);
    expect(stepsFor("initial", { liveSlice: 5, hasBackground: true })).toEqual(
      STEPS_BY_KIND.initial,
    );
    expect(stepsFor("reanalyse", { liveSlice: 5 })).toEqual(["ai_edit", "render"]);
  });
});
