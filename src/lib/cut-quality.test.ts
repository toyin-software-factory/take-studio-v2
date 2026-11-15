import { describe, expect, it } from "vitest";
import { combineScores, cutCaseSchema, missesOf, scoreCuts, type ScoredCut } from "./cut-quality";
import { span } from "./cut-quality-test-helpers";

const cut = (startMs: number, endMs: number, kind: ScoredCut["kind"] = "filler"): ScoredCut => ({
  startMs,
  endMs,
  kind,
});
describe("scoreCuts", () => {
  it("exact match scores 1 and 1", () => {
    const s = scoreCuts([span(1000, 2000)], [cut(1000, 2000)]);
    expect(s).toMatchObject({ precision: 1, recall: 1, wrongKeeps: 0 });
    expect(s.tally.hitSpans).toBe(1);
  });

  it("a partial cut lowers recall and counts a hit only from 60%", () => {
    const hit = scoreCuts([span(0, 1000)], [cut(0, 600)]);
    expect(hit.recall).toBeCloseTo(0.6);
    expect(hit.precision).toBe(1);
    expect(hit.tally.hitSpans).toBe(1);
    const miss = scoreCuts([span(0, 1000)], [cut(0, 500)]);
    expect(miss.recall).toBeCloseTo(0.5);
    expect(miss.tally.hitSpans).toBe(0);
  });

  it("a missing cut gives recall 0 and precision 1 (nothing wrong was cut)", () => {
    expect(scoreCuts([span(0, 1000)], [])).toMatchObject({ precision: 1, recall: 0 });
  });

  it("cutting a keep span counts one wrong keep and lowers precision", () => {
    const s = scoreCuts([span(0, 1000), span(2000, 3000, "keep")], [cut(0, 1000), cut(2000, 3000)]);
    expect(s.wrongKeeps).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.precision).toBeCloseTo(0.5);
  });

  it("50% of a keep span cut is not yet wrong, 60% is", () => {
    const keep = [span(0, 1000, "keep")];
    expect(scoreCuts(keep, [cut(0, 500)]).wrongKeeps).toBe(0);
    expect(scoreCuts(keep, [cut(0, 600)]).wrongKeeps).toBe(1);
  });

  it("cutting where nothing was marked lowers precision", () => {
    expect(scoreCuts([span(0, 1000)], [cut(0, 1000), cut(5000, 6000)]).precision).toBeCloseTo(0.5);
  });

  it("an empty take (nothing to cut, nothing cut) scores 1 and 1", () => {
    expect(scoreCuts([], [])).toMatchObject({ precision: 1, recall: 1, wrongKeeps: 0 });
  });

  it("overlapping cuts are not double counted", () => {
    const s = scoreCuts([span(0, 1000)], [cut(0, 800), cut(400, 1000)]);
    expect(s).toMatchObject({ precision: 1, recall: 1 });
  });

  it("splits by kind: recall by the marked kind, precision by the cut kind", () => {
    const expected = [span(0, 1000, "cut", "filler"), span(2000, 3000, "cut", "pause")];
    const s = scoreCuts(expected, [cut(0, 1000, "filler")]);
    expect(s.byKind.filler).toMatchObject({ precision: 1, recall: 1 });
    expect(s.byKind.pause).toMatchObject({ precision: 1, recall: 0 });
    expect(s.byKind.false_start).toMatchObject({ precision: 1, recall: 1 });
  });

  it("combineScores adds counts, not ratios", () => {
    const a = scoreCuts([span(0, 1000)], [cut(0, 1000)]);
    const b = scoreCuts([span(0, 9000)], []);
    expect(combineScores([a, b]).recall).toBeCloseTo(0.1);
  });
});
describe("either copy of a doubled word (B2-T73)", () => {
  // A word said twice: the second copy at 1200-1600, the first at 800-1200.
  const doubled = [
    { ...span(1200, 1600, "cut", "false_start"), either: { startMs: 800, endMs: 1200 } },
  ];

  it("cutting the marked copy scores 1 and 1", () => {
    const s = scoreCuts(doubled, [cut(1200, 1600, "false_start")]);
    expect(s).toMatchObject({ precision: 1, recall: 1 });
    expect(s.tally.hitSpans).toBe(1);
  });

  it("cutting the other copy scores 1 and 1 too", () => {
    const s = scoreCuts(doubled, [cut(800, 1200, "false_start")]);
    expect(s).toMatchObject({ precision: 1, recall: 1 });
    expect(missesOf(doubled, [cut(800, 1200, "false_start")]).missed).toEqual([]);
  });

  it("cutting neither copy is still a miss", () => {
    const s = scoreCuts(doubled, [cut(3000, 3400, "false_start")]);
    expect(s).toMatchObject({ precision: 0, recall: 0 });
    expect(missesOf(doubled, [])).toMatchObject({ missed: [{ startMs: 1200, endMs: 1600 }] });
  });

  it("cutting both copies keeps one right and counts the other as a wrong cut", () => {
    const s = scoreCuts(doubled, [cut(800, 1600, "false_start")]);
    expect(s.recall).toBe(1);
    expect(s.precision).toBeCloseTo(0.5);
  });

  it("the case schema takes an either on a cut span, and refuses it on a keep or an overlap", () => {
    const base = { id: "x", note: "n", durationMs: 5000, pauses: [] } as const;
    const words = [{ w: "a", startMs: 0, endMs: 100, filler: false }];
    const ok = cutCaseSchema.safeParse({ ...base, words, expected: doubled });
    expect(ok.success).toBe(true);
    const keep = { ...span(1200, 1600, "keep"), either: { startMs: 800, endMs: 1200 } };
    expect(cutCaseSchema.safeParse({ ...base, words, expected: [keep] }).success).toBe(false);
    const overlap = [...doubled, span(900, 1000)];
    expect(cutCaseSchema.safeParse({ ...base, words, expected: overlap }).success).toBe(false);
  });
});
