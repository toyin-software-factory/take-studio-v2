import { describe, expect, it } from "vitest";
import baseline from "./cut-quality-data/baseline.json";
import { CASE_ENTRIES } from "./cut-quality-cases";
import { aiEditAnswerSchema, validateAiEdit } from "./ai-edit";
import {
  CUT_QUALITY_MIN_TAKES,
  countCuts,
  cutRate,
  summariseCutQuality,
  type CutRow,
  combineScores,
  cutCaseSchema,
  missesOf,
  scoreCuts,
  type CutCase,
  type ScoredCut,
} from "./cut-quality";
import { span } from "./cut-quality-test-helpers";

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

  it("has the script cases, and the heavy retakes case needs the script share (spec 0021, AC-13)", () => {
    const withScript = cases.flatMap((c) =>
      c.parsed.success && c.parsed.data.script ? [c.parsed.data.id] : [],
    );
    for (const id of [
      "script-line-twice",
      "script-line-three-times",
      "script-fluffed-then-clean",
      "script-heavy-retakes",
      "script-ad-lib",
      "script-skipped-line",
    ])
      expect(withScript, id).toContain(id);
    const heavy = cases.find(
      (c) => c.parsed.success && c.parsed.data.id === "script-heavy-retakes",
    );
    if (!heavy || !heavy.parsed.success) throw new Error("script-heavy-retakes is missing");
    const c = heavy.parsed.data;
    const candidates = c.pauses.map((p) => ({ ...p, reason: "Pause" }));
    const answer = aiEditAnswerSchema.parse(heavy.answer);
    expect(validateAiEdit(answer, c.words, candidates, c.durationMs).ok).toBe(false);
    expect(validateAiEdit(answer, c.words, candidates, c.durationMs, [], true).ok).toBe(true);
  });

  /** The cuts the pipeline would apply for a case: the rules' pauses, plus the recorded answer if `useAi`. */
  function appliedCuts(c: CutCase, answerRaw: unknown, useAi: boolean): ScoredCut[] {
    const candidates = c.pauses.map((p) => ({ ...p, reason: "Pause" }));
    const rules: ScoredCut[] = candidates.map((p) => ({ ...p, kind: "pause" }));
    if (!useAi) return rules;
    const answer = aiEditAnswerSchema.parse(answerRaw);
    const valid = validateAiEdit(answer, c.words, candidates, c.durationMs, [], Boolean(c.script));
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
describe("countCuts, summariseCutQuality and cutRate (spec 0017, AC-5, AC-6)", () => {
  const kept = "Kept: deliberate pause";
  const row = (o: Partial<CutRow>): CutRow => ({
    kind: "filler",
    proposedBy: "ai",
    reason: null,
    applied: true,
    creatorChangedAt: null,
    ...o,
  });

  it("counts undone, restored kept pauses and creator added cuts", () => {
    const c = countCuts(
      [
        row({}),
        row({ applied: false, creatorChangedAt: new Date() }),
        row({ kind: "pause", reason: kept, creatorChangedAt: new Date() }),
        row({ kind: "pause", reason: kept, applied: false }),
        row({ kind: "manual", proposedBy: "creator" }),
      ],
      kept,
    );
    expect(c.ai.filler).toMatchObject({ proposed: 2, undone: 1 });
    expect(c.ai.pause).toMatchObject({ proposed: 2, restored: 1, kept: 2 });
    expect(c.creator.manual.added).toBe(1);
  });

  it("sums one snapshot per take and hides rates below the minimum", () => {
    const one = countCuts([row({}), row({ applied: false, creatorChangedAt: new Date() })], kept);
    const q = summariseCutQuality([one, one], 3);
    expect(q.reviewedTakes).toBe(2);
    expect(q.missed).toBe(3);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0]?.tally).toMatchObject({ proposed: 4, undone: 2 });
    expect(cutRate(2, 4, 2)).toBeNull();
    expect(cutRate(2, 4, CUT_QUALITY_MIN_TAKES)).toBe(50);
    expect(cutRate(0, 0, CUT_QUALITY_MIN_TAKES)).toBeNull();
  });
});
describe("missesOf (spec 0017 AC-10)", () => {
  const expected = [
    { startMs: 0, endMs: 1000, verdict: "cut", kind: "filler" },
    { startMs: 2000, endMs: 3000, verdict: "keep", kind: "filler" },
  ] as const;

  it("lists a cut span below 60% and a keep span cut at 60% or more", () => {
    const r = missesOf(expected, [
      { startMs: 0, endMs: 500, kind: "filler" },
      { startMs: 2000, endMs: 2600, kind: "filler" },
    ]);
    expect(r.missed).toEqual([{ startMs: 0, endMs: 1000, kind: "filler" }]);
    expect(r.wrongKeeps).toEqual([{ startMs: 2000, endMs: 3000, kind: "filler" }]);
  });

  it("is empty for a clean answer", () => {
    const r = missesOf(expected, [{ startMs: 0, endMs: 1000, kind: "filler" }]);
    expect(r).toEqual({ missed: [], wrongKeeps: [] });
  });
});
