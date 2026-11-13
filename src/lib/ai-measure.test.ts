import { describe, expect, it } from "vitest";
import { aiMeasurePayloadSchema, countAiCuts, realCatalog } from "./ai-measure";
import { BUILT_IN_BACKGROUNDS } from "./built-in-backgrounds";

describe("aiMeasurePayloadSchema", () => {
  it("takes a token and one of the two clips", () => {
    expect(aiMeasurePayloadSchema.safeParse({ token: "t", clip: "speech" }).success).toBe(true);
    expect(aiMeasurePayloadSchema.safeParse({ token: "t", clip: "ten-min" }).success).toBe(true);
  });
  it("refuses a missing or unknown clip, and a missing or empty token", () => {
    for (const payload of [
      { token: "t" },
      { token: "t", clip: "long" },
      { token: "", clip: "speech" },
      { clip: "speech" },
      null,
      "x",
    ]) {
      expect(aiMeasurePayloadSchema.safeParse(payload).success).toBe(false);
    }
  });
});

describe("realCatalog", () => {
  it("is the real built in studios, never the test only one", () => {
    const catalog = realCatalog();
    const real = BUILT_IN_BACKGROUNDS.filter((b) => b.testOnly !== true);
    expect(catalog.map((c) => c.id)).toEqual(real.map((b) => b.id));
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.length).toBeLessThan(BUILT_IN_BACKGROUNDS.length + 1);
  });
});

describe("countAiCuts", () => {
  it("counts the AI cuts and the applied ones (a kept pause is unapplied)", () => {
    expect(
      countAiCuts([
        { startMs: 0, endMs: 1, kind: "pause", proposedBy: "ai", applied: false },
        { startMs: 2, endMs: 3, kind: "filler", proposedBy: "ai" },
        { startMs: 4, endMs: 5, kind: "pause", proposedBy: "rules" },
      ]),
    ).toEqual({ aiCuts: 2, aiCutsApplied: 1 });
  });
});
