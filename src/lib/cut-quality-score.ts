import { CUT_KINDS, type CutKind } from "./cuts";
import type { ExpectedSpan, ScoredCut } from "./cut-quality-case";

/** A span counts as hit when at least this share of its time is covered (spec 0017 AC-8). */
export const HIT_SHARE = 0.6;

// ----- Time arithmetic -----

type Span = { readonly startMs: number; readonly endMs: number };

/** Sorted spans with overlaps and touching spans merged. */
export function union(spans: readonly Span[]): Span[] {
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

/** A span counts as hit (a `cut` span cut, a `keep` span wrongly cut) at 60% coverage. */
export function isHit(span: Span, merged: readonly Span[]): boolean {
  return coveredMs(span, merged) >= HIT_SHARE * (span.endMs - span.startMs);
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

/**
 * Settles each span that has an `either` copy: the copy the cuts covered more stands for it (the
 * span itself on a tie), so cutting either copy of a doubled word is right.
 */
export function settleEither(
  expected: readonly ExpectedSpan[],
  actual: readonly ScoredCut[],
): ExpectedSpan[] {
  const cutAll = union(actual);
  return expected.map(({ either, ...span }) =>
    either && coveredMs(either, cutAll) > coveredMs(span, cutAll) ? { ...span, ...either } : span,
  );
}

function tallyOf(
  allExpected: readonly ExpectedSpan[],
  actual: readonly ScoredCut[],
  expectedKind?: CutKind,
): Tally {
  const expected = settleEither(allExpected, actual);
  const rightToCut = union(expected.filter((e) => e.verdict === "cut"));
  const cutAll = union(actual);
  // Precision looks at what was cut (by the kind the pipeline gave it); recall at what had to be cut.
  const cutOfKind = expectedKind ? union(actual.filter((a) => a.kind === expectedKind)) : cutAll;
  const mine = expected.filter((e) => expectedKind === undefined || e.kind === expectedKind);
  const mustCut = mine.filter((e) => e.verdict === "cut");
  const keeps = mine.filter((e) => e.verdict === "keep");
  const share60 = (e: Span) => isHit(e, cutAll);
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
