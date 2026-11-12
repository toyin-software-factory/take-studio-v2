import { describe, expect, it } from "vitest";
import { checkFfmpeg, ffmpegPlan, inCi } from "./ffmpeg";

describe("ffmpeg guard (HRF-T06)", () => {
  const missing = { ok: false, reason: "ffmpeg was not found" } as const;

  it("runs the suite when the tools are there, in CI or not", () => {
    expect(ffmpegPlan({ ok: true }, true, "suite")).toEqual({ kind: "run" });
    expect(ffmpegPlan({ ok: true }, false, "suite")).toEqual({ kind: "run" });
  });

  it("fails in CI when ffmpeg is missing, with a message that says what to install", () => {
    const plan = ffmpegPlan(missing, true, "ingest with the real image tools");
    expect(plan.kind).toBe("fail");
    if (plan.kind === "run") throw new Error("unreachable");
    expect(plan.message).toContain("ingest with the real image tools");
    expect(plan.message).toContain("ffmpeg was not found");
    expect(plan.message).toContain("CI must run this suite");
    expect(plan.message).toContain("pinned BtbN");
  });

  it("skips locally when ffmpeg is missing, with a visible note", () => {
    const plan = ffmpegPlan(missing, false, "suite");
    expect(plan.kind).toBe("skip");
    if (plan.kind === "run") throw new Error("unreachable");
    expect(plan.message).toContain("SKIPPED");
    expect(plan.message).toContain("CI runs it with the pinned ffmpeg");
  });

  it("treats CI=true as CI, and an empty, false or 0 value as a local run", () => {
    expect(inCi({ CI: "true" })).toBe(true);
    expect(inCi({ CI: "1" })).toBe(true);
    for (const value of [undefined, "", "false", "0"]) expect(inCi({ CI: value })).toBe(false);
  });

  it("reports a reason when the tools are missing (this machine either has them or says why not)", () => {
    const check = checkFfmpeg();
    if (!check.ok) expect(check.reason).toMatch(/ffmpeg|ffprobe|libwebp/);
  });
});
