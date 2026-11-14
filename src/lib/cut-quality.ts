import { z } from "zod";
import { CUT_KINDS, type CutKind } from "./cuts";

/**
 * Cut quality measurement (spec 0017, AC-7 and AC-8). Pure: the written test case schema and
 * `scoreCuts`. A case is an invented transcript in the shape the AI edit reads (words, times,
 * filler flags, pause candidates) with the right cuts marked. No real creator words anywhere.
 */

/** /insights shows "too few takes" below this many reviewed takes (spec 0017 AC-5). */
export const CUT_QUALITY_MIN_TAKES = 5;

/** A span counts as hit when at least this share of its time is covered (spec 0017 AC-8). */
export const HIT_SHARE = 0.6;

// ----- The case -----

const ms = z.number().int().min(0).max(3_600_000);

const spanFields = { startMs: ms, endMs: ms };
const orderedSpan = (s: { startMs: number; endMs: number }) => s.startMs < s.endMs;

const wordSchema = z
  .object({ w: z.string().min(1).max(40), ...spanFields, filler: z.boolean() })
  .strict()
  .refine(orderedSpan, "word must end after it starts");

const pauseSchema = z
  .object(spanFields)
  .strict()
  .refine(orderedSpan, "pause must end after it starts");

const expectedSchema = z
  .object({
    ...spanFields,
    kind: z.enum(CUT_KINDS),
    verdict: z.enum(["cut", "keep"]),
  })
  .strict()
  .refine(orderedSpan, "span must end after it starts");

export const cutCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    /** Why the case exists, in plain words about the pattern. Never real speech. */
    note: z.string().min(1).max(300),
    durationMs: z.number().int().positive().max(3_600_000),
    words: z.array(wordSchema).min(1),
    pauses: z.array(pauseSchema),
    expected: z.array(expectedSchema),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    c.words.forEach((word, i) => {
      const prev = c.words[i - 1];
      if (prev && word.startMs < prev.endMs) fail(`word ${i} overlaps the word before it`);
      if (word.endMs > c.durationMs) fail(`word ${i} ends after the take`);
    });
    c.pauses.forEach((pause, i) => {
      const prev = c.pauses[i - 1];
      if (prev && pause.startMs < prev.endMs) fail(`pause ${i} overlaps the pause before it`);
      if (pause.endMs > c.durationMs) fail(`pause ${i} ends after the take`);
    });
    const sorted = [...c.expected].sort((a, b) => a.startMs - b.startMs);
    sorted.forEach((span, i) => {
      const prev = sorted[i - 1];
      if (prev && span.startMs < prev.endMs) fail("expected spans must not overlap");
      if (span.endMs > c.durationMs) fail("an expected span ends after the take");
    });
  });
export type CutCase = z.infer<typeof cutCaseSchema>;
export type ExpectedSpan = CutCase["expected"][number];

/** A cut as scored: the applied cuts the pipeline produced. */
export type ScoredCut = {
  readonly startMs: number;
  readonly endMs: number;
  readonly kind: CutKind;
};

// ----- Time arithmetic -----

type Span = { readonly startMs: number; readonly endMs: number };

/** Sorted spans with overlaps and touching spans merged. */
function union(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.endMs > s.startMs)
    .map((s) => ({ startMs: s.startMs, endMs: s.endMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.startMs <= last.endMs) {
      merged[merged.length - 1] = {
        startMs: last.startMs,
        endMs: Math.max(last.endMs, span.endMs),
      };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

const lengthMs = (spans: readonly Span[]): number =>
  spans.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

/** Milliseconds of `span` covered by `merged` (a union, so no double counting). */
function coveredMs(span: Span, merged: readonly Span[]): number {
  return merged.reduce(
    (sum, m) =>
      sum + Math.max(0, Math.min(span.endMs, m.endMs) - Math.max(span.startMs, m.startMs)),
    0,
  );
}

// ----- Scoring -----

/** Counts that add up across cases; the ratios are derived from them. */
export type Tally = {
  /** Time the pipeline cut. */
  readonly cutMs: number;
  /** Of that, time inside spans that were right to cut. */
  readonly rightCutMs: number;
  /** Time that had to be cut. */
  readonly mustCutMs: number;
  /** Of that, time that was cut. */
  readonly mustCutCoveredMs: number;
  /** `cut` spans, and how many were hit (at least 60% covered). */
  readonly mustCutSpans: number;
  readonly hitSpans: number;
  /** `keep` spans cut at least 60%. */
  readonly wrongKeeps: number;
};

export type Ratios = {
  /** Share of cut time that was right to cut. 1 when nothing was cut. */
  readonly precision: number;
  /** Share of must cut time that was cut. 1 when nothing had to be cut. */
  readonly recall: number;
  readonly wrongKeeps: number;
};

export type CutScore = Ratios & {
  readonly tally: Tally;
  readonly byKind: Readonly<Record<CutKind, Ratios & { readonly tally: Tally }>>;
};

const EMPTY_TALLY: Tally = {
  cutMs: 0,
  rightCutMs: 0,
  mustCutMs: 0,
  mustCutCoveredMs: 0,
  mustCutSpans: 0,
  hitSpans: 0,
  wrongKeeps: 0,
};

const share = (part: number, whole: number): number => (whole === 0 ? 1 : part / whole);

function ratios(tally: Tally): Ratios & { readonly tally: Tally } {
  return {
    precision: share(tally.rightCutMs, tally.cutMs),
    recall: share(tally.mustCutCoveredMs, tally.mustCutMs),
    wrongKeeps: tally.wrongKeeps,
    tally,
  };
}

const addTally = (a: Tally, b: Tally): Tally => ({
  cutMs: a.cutMs + b.cutMs,
  rightCutMs: a.rightCutMs + b.rightCutMs,
  mustCutMs: a.mustCutMs + b.mustCutMs,
  mustCutCoveredMs: a.mustCutCoveredMs + b.mustCutCoveredMs,
  mustCutSpans: a.mustCutSpans + b.mustCutSpans,
  hitSpans: a.hitSpans + b.hitSpans,
  wrongKeeps: a.wrongKeeps + b.wrongKeeps,
});

function tallyOf(
  expected: readonly ExpectedSpan[],
  actual: readonly ScoredCut[],
  expectedKind?: CutKind,
): Tally {
  const rightToCut = union(expected.filter((e) => e.verdict === "cut"));
  const cutAll = union(actual);
  // Precision looks at what was cut (by the kind the pipeline gave it); recall at what had to be cut.
  const cutOfKind = expectedKind ? union(actual.filter((a) => a.kind === expectedKind)) : cutAll;
  const mine = expected.filter((e) => expectedKind === undefined || e.kind === expectedKind);
  const mustCut = mine.filter((e) => e.verdict === "cut");
  const keeps = mine.filter((e) => e.verdict === "keep");
  const share60 = (e: Span) => coveredMs(e, cutAll) >= HIT_SHARE * (e.endMs - e.startMs);
  return {
    cutMs: lengthMs(cutOfKind),
    rightCutMs: cutOfKind.reduce((sum, c) => sum + coveredMs(c, rightToCut), 0),
    mustCutMs: lengthMs(mustCut),
    mustCutCoveredMs: mustCut.reduce((sum, e) => sum + coveredMs(e, cutAll), 0),
    mustCutSpans: mustCut.length,
    hitSpans: mustCut.filter(share60).length,
    wrongKeeps: keeps.filter(share60).length,
  };
}

/**
 * Scores the cuts a pipeline produced for one case against the marked spans (spec 0017 AC-8).
 * Precision is time based: the share of cut time inside a span that was right to cut, so cutting
 * a word that should stay lowers it. Recall is the share of must cut time that was cut. A `keep`
 * span counts as wrongly cut at 60% coverage, and a `cut` span counts as hit at 60% (same
 * threshold). The kind split gives precision by the kind the pipeline gave its cut, and recall
 * and wrong keeps by the kind of the marked span. An empty take (nothing to cut, nothing cut)
 * scores 1 and 1.
 */
export function scoreCuts(
  expected: readonly ExpectedSpan[],
  actual: readonly ScoredCut[],
): CutScore {
  const byKind = Object.fromEntries(
    CUT_KINDS.map((kind) => [kind, ratios(tallyOf(expected, actual, kind))]),
  ) as CutScore["byKind"];
  return { ...ratios(tallyOf(expected, actual)), byKind };
}

/** Adds scores together (every case, or the held out third): totals, not an average of ratios. */
export function combineScores(scores: readonly CutScore[]): CutScore {
  const total = scores.reduce((sum, s) => addTally(sum, s.tally), EMPTY_TALLY);
  const byKind = Object.fromEntries(
    CUT_KINDS.map((kind) => [
      kind,
      ratios(scores.reduce((sum, s) => addTally(sum, s.byKind[kind].tally), EMPTY_TALLY)),
    ]),
  ) as CutScore["byKind"];
  return { ...ratios(total), byKind };
}
