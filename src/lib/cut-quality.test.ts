import { describe, expect, it } from "vitest";
import baseline from "../../tests/cut-quality/baseline.json";
import { CASE_ENTRIES } from "../../tests/cut-quality/cases";
import { aiEditAnswerSchema, validateAiEdit } from "./ai-edit";
import {
  CUT_QUALITY_MIN_TAKES,
  combineScores,
  cutCaseSchema,
  scoreCuts,
  type CutCase,
  type ExpectedSpan,
  type ScoredCut,
} from "./cut-quality";

const cut = (startMs: number, endMs: number, kind: ScoredCut["kind"] = "filler"): ScoredCut => ({
  startMs,
  endMs,
  kind,
});
const span = (
  startMs: number,
  endMs: number,
  verdict: ExpectedSpan["verdict"] = "cut",
  kind: ExpectedSpan["kind"] = "filler",
): ExpectedSpan => ({ startMs, endMs, kind, verdict });

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

describe("the written cut quality test set", () => {
  const cases = CASE_ENTRIES.map((e) => ({ ...e, parsed: cutCaseSchema.safeParse(e.raw) }));

  it("has 12 or more cases, at least a third held out", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.filter((c) => c.holdout).length).toBeGreaterThanOrEqual(cases.length / 3);
    expect(new Set(cases.map((c) => c.parsed.success && c.parsed.data.id)).size).toBe(cases.length);
  });

  it("every case passes the schema", () => {
    for (const c of cases)
      expect(c.parsed.success, JSON.stringify(c.parsed.error?.issues)).toBe(true);
  });

  it("the schema rejects a bad case", () => {
    const good = CASE_ENTRIES[0]?.raw as CutCase;
    expect(cutCaseSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(cutCaseSchema.safeParse({ ...good, durationMs: 1 }).success).toBe(false);
    expect(cutCaseSchema.safeParse({ ...good, words: [] }).success).toBe(false);
    const overlapping = { ...good, expected: [span(0, 100), span(50, 150)] };
    expect(cutCaseSchema.safeParse(overlapping).success).toBe(false);
  });

  it("covers the required patterns", () => {
    const words = cases.flatMap((c) =>
      c.parsed.success ? c.parsed.data.words.map((w) => w.w) : [],
    );
    for (const w of ["uh", "um", "hmm", "blah", "know", "sort", "basically", "okay", "right"]) {
      expect(words, w).toContain(w === "okay" ? "Okay" : w);
    }
    const all = cases.flatMap((c) => (c.parsed.success ? c.parsed.data.expected : []));
    expect(all.some((e) => e.kind === "pause" && e.verdict === "keep")).toBe(true);
    expect(all.some((e) => e.kind === "filler" && e.verdict === "keep")).toBe(true);
    expect(cases.some((c) => c.parsed.success && c.parsed.data.expected.length === 0)).toBe(true);
  });

  /** The cuts the pipeline would apply for a case: the rules' pauses, plus the recorded answer if `useAi`. */
  function appliedCuts(c: CutCase, answerRaw: unknown, useAi: boolean): ScoredCut[] {
    const candidates = c.pauses.map((p) => ({ ...p, reason: "Pause" }));
    const rules: ScoredCut[] = candidates.map((p) => ({ ...p, kind: "pause" }));
    if (!useAi) return rules;
    const answer = aiEditAnswerSchema.parse(answerRaw);
    const valid = validateAiEdit(answer, c.words, candidates, c.durationMs);
    expect(valid.ok, `${c.id}: answer refused`).toBe(true);
    if (!valid.ok) throw new Error("unreachable");
    expect(valid.data.dropped, `${c.id}: items dropped`).toBe(0);
    return valid.data.cuts
      .filter((x) => x.applied)
      .map((x) => ({ startMs: x.startMs, endMs: x.endMs, kind: x.kind }));
  }

  function run(c: CutCase, answerRaw: unknown, useAi: boolean) {
    return scoreCuts(c.expected, appliedCuts(c, answerRaw, useAi));
  }

  const scored = (pred: (h: boolean) => boolean, useAi: boolean) =>
    combineScores(
      cases.flatMap((c) =>
        c.parsed.success && pred(c.holdout) ? [run(c.parsed.data, c.answer, useAi)] : [],
      ),
    );

  it("rules plus recorded model answers stay at or above the floor (all cases)", () => {
    const s = scored(() => true, true);
    expect(s.recall).toBeGreaterThanOrEqual(baseline.all.recall);
    expect(s.precision).toBeGreaterThanOrEqual(baseline.all.precision);
  });

  it("names every must cut span the recorded answers miss, and no new one (CodeRabbit, #227)", () => {
    const missed = cases.flatMap((c) => {
      if (!c.parsed.success) return [];
      const data = c.parsed.data;
      const cuts = appliedCuts(data, c.answer, true);
      return data.expected
        .filter((e) => e.verdict === "cut")
        .filter((e) => scoreCuts([e], cuts).tally.hitSpans === 0)
        .map((e) => `${data.id}@${e.startMs}`);
    });
    // The hand written answers carry deliberate flaws (see baseline.json notes): those are the
    // only misses allowed. A lost span anywhere else fails here by name.
    expect(missed.sort()).toEqual([...baseline.knownMisses].sort());
  });

  it("the held out third stays at or above its own floor", () => {
    const s = scored((h) => h, true);
    expect(s.recall).toBeGreaterThanOrEqual(baseline.holdout.recall);
    expect(s.precision).toBeGreaterThanOrEqual(baseline.holdout.precision);
  });

  it("the rules path alone stays at or above its floor", () => {
    const s = scored(() => true, false);
    expect(s.recall).toBeGreaterThanOrEqual(baseline.rules.recall);
    expect(s.precision).toBeGreaterThanOrEqual(baseline.rules.precision);
  });

  it("the AI answers beat the rules on recall (the reason the AI edit exists)", () => {
    expect(scored(() => true, true).recall).toBeGreaterThan(scored(() => true, false).recall);
  });

  it("a must cut span that stops being cut fails the floor", () => {
    const c = cases.find((x) => x.parsed.success && x.parsed.data.id === "plain-fillers");
    if (!c?.parsed.success) throw new Error("case missing");
    const empty = { keepPauses: [], wordCuts: [], fixes: [], background: null };
    const good = run(c.parsed.data, c.answer, true);
    const broken = run(c.parsed.data, empty, true);
    expect(good.recall).toBeGreaterThan(broken.recall);
  });

  it("the minimum takes constant is 5", () => {
    expect(CUT_QUALITY_MIN_TAKES).toBe(5);
  });
});
