import { describe, expect, it } from "vitest";
import {
  type CutLike,
  type ProposedCut,
  cleanReason,
  isWithinTake,
  overlaps,
  planReanalysis,
  removedRanges,
  renderKey,
} from "./cut-rules";

describe("cut ranges (AC-8)", () => {
  it("accepts 0 ≤ start < end ≤ length, in whole milliseconds", () => {
    expect(isWithinTake({ startMs: 0, endMs: 1000 }, 1000)).toBe(true);
    expect(isWithinTake({ startMs: 500, endMs: 500 }, 1000)).toBe(false);
    expect(isWithinTake({ startMs: -1, endMs: 10 }, 1000)).toBe(false);
    expect(isWithinTake({ startMs: 10, endMs: 1001 }, 1000)).toBe(false);
    expect(isWithinTake({ startMs: 1.5, endMs: 10 }, 1000)).toBe(false);
  });

  it("treats touching cuts as not overlapping", () => {
    expect(overlaps({ startMs: 0, endMs: 100 }, { startMs: 100, endMs: 200 })).toBe(false);
    expect(overlaps({ startMs: 0, endMs: 101 }, { startMs: 100, endMs: 200 })).toBe(true);
    expect(overlaps({ startMs: 50, endMs: 60 }, { startMs: 0, endMs: 200 })).toBe(true);
  });

  it("cleans reasons", () => {
    expect(cleanReason("  ")).toBeNull();
    expect(cleanReason(undefined)).toBeNull();
    expect(cleanReason("x".repeat(300))).toHaveLength(280);
  });
});

describe("planReanalysis (AC-9)", () => {
  const cut = (
    id: string,
    startMs: number,
    endMs: number,
    extra: Partial<CutLike> = {},
  ): CutLike => ({
    id,
    startMs,
    endMs,
    proposedBy: "rules",
    creatorChangedAt: null,
    ...extra,
  });
  const proposal = (startMs: number, endMs: number): ProposedCut => ({
    startMs,
    endMs,
    kind: "pause",
    proposedBy: "ai",
  });

  it("keeps creator changed and manual cuts, replaces untouched rules and AI cuts", () => {
    const existing = [
      cut("untouched-rules", 0, 100),
      cut("untouched-ai", 200, 300, { proposedBy: "ai" }),
      cut("changed", 400, 500, { creatorChangedAt: new Date() }),
      cut("manual", 600, 700, { proposedBy: "creator", creatorChangedAt: new Date() }),
    ];
    const plan = planReanalysis(existing, [proposal(10, 90), proposal(800, 900)], 1000);
    expect(plan.remove).toEqual(["untouched-rules", "untouched-ai"]);
    expect(plan.add.map((p) => [p.startMs, p.endMs])).toEqual([
      [10, 90],
      [800, 900],
    ]);
    expect(plan.dropped).toEqual([]);
  });

  it("drops proposals that overlap a kept cut, an earlier proposal, or leave the take", () => {
    const existing = [cut("changed", 400, 500, { creatorChangedAt: new Date() })];
    const plan = planReanalysis(
      existing,
      [proposal(450, 550), proposal(0, 100), proposal(50, 150), proposal(900, 1100)],
      1000,
    );
    expect(plan.add.map((p) => [p.startMs, p.endMs])).toEqual([[0, 100]]);
    expect(plan.dropped.map((p) => [p.startMs, p.endMs])).toEqual([
      [50, 150],
      [450, 550],
      [900, 1100],
    ]);
  });
});

describe("render snapshot (AC-10)", () => {
  it("keeps only applied cuts, in start order", () => {
    expect(
      removedRanges([
        { startMs: 500, endMs: 600, applied: true },
        { startMs: 0, endMs: 100, applied: true },
        { startMs: 200, endMs: 300, applied: false },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 100 },
      { startMs: 500, endMs: 600 },
    ]);
  });

  it("derives the render key", () => {
    expect(renderKey("t1", "r1")).toBe("renders/t1/r1.mp4");
  });
});
