import { z } from "zod";
import { SCRIPT_MAX_CHARS } from "./processing";
import { CUT_KINDS, CUT_PROPOSERS, type CutKind, type CutProposer } from "./cuts";

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
  .object({
    w: z.string().min(1).max(40),
    ...spanFields,
    filler: z.boolean(),
    /** Transcriber confidence; omit for a clearly heard word. */
    conf: z.number().min(0).max(1).optional(),
  })
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
    /** Spec 0021: the invented script of a take read from one. Omitted for a take with none. */
    script: z.string().trim().min(1).max(SCRIPT_MAX_CHARS).optional(),
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

// ----- Field counts at download (spec 0017 AC-1, AC-5) -----

export type CutTally = {
  readonly proposed: number;
  readonly undone: number;
  readonly restored: number;
  /** Kept pauses: system pauses proposed off (the denominator of the restore rate). */
  readonly kept: number;
  readonly added: number;
};
export type CutCounts = Readonly<Record<CutProposer, Readonly<Record<CutKind, CutTally>>>>;

/** The cut columns the counts read. No time, word or reason leaves this function. */
export type CutRow = {
  readonly kind: string;
  readonly proposedBy: string;
  readonly reason: string | null;
  readonly applied: boolean;
  readonly creatorChangedAt: Date | null;
};

const ZERO: CutTally = { proposed: 0, undone: 0, restored: 0, kept: 0, added: 0 };

const emptyCounts = (): Record<CutProposer, Record<CutKind, CutTally>> =>
  Object.fromEntries(
    CUT_PROPOSERS.map((p) => [p, Object.fromEntries(CUT_KINDS.map((k) => [k, ZERO]))]),
  ) as Record<CutProposer, Record<CutKind, CutTally>>;

const isProposer = (v: string): v is CutProposer =>
  (CUT_PROPOSERS as readonly string[]).includes(v);
const isKind = (v: string): v is CutKind => (CUT_KINDS as readonly string[]).includes(v);

/**
 * Counts a take's cut rows by proposer and kind (spec 0017 AC-1). `proposed`: system cuts
 * (rules or AI), applied or not at proposal. `undone`: a system cut the creator turned off.
 * `restored`: a kept pause (`keptPauseReason`, stored off) the creator turned on; `kept` counts every such pause, the restore rate's denominator (a fifth count beyond the spec's four). `added`: the
 * creator's own cuts. Pure; integers only.
 */
export function countCuts(rows: readonly CutRow[], keptPauseReason: string): CutCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    if (!isProposer(row.proposedBy) || !isKind(row.kind)) continue;
    const t = counts[row.proposedBy][row.kind];
    const touched = row.creatorChangedAt !== null;
    const isKept = row.reason === keptPauseReason;
    counts[row.proposedBy][row.kind] =
      row.proposedBy === "creator"
        ? { ...t, added: t.added + 1 }
        : {
            ...t,
            proposed: t.proposed + 1,
            undone: t.undone + (touched && !row.applied ? 1 : 0),
            restored: t.restored + (touched && row.applied && isKept ? 1 : 0),
            kept: t.kept + (isKept ? 1 : 0),
          };
  }
  return counts;
}

/** One reviewed take's counts, summed over takes for the /insights table. */
export type CutQualityRow = {
  readonly proposer: CutProposer;
  readonly kind: CutKind;
  readonly takes: number;
  readonly tally: CutTally;
};

export type CutQuality = {
  readonly reviewedTakes: number;
  readonly missed: number;
  readonly rows: readonly CutQualityRow[];
};

/**
 * Sums the latest snapshot of each take (the caller passes one per take, so repeat downloads
 * never double count). `takes` of a row is how many of those takes had any cut of that proposer
 * and kind. Rows nobody ever produced are left out.
 */
export function summariseCutQuality(snapshots: readonly CutCounts[], missed: number): CutQuality {
  const rows = CUT_PROPOSERS.flatMap((proposer) =>
    CUT_KINDS.map((kind): CutQualityRow => {
      const cells = snapshots.map((s) => s[proposer][kind]);
      const active = cells.filter((c) => c.proposed + c.added > 0);
      return {
        proposer,
        kind,
        takes: active.length,
        tally: active.reduce(
          (a, c) => ({
            proposed: a.proposed + c.proposed,
            undone: a.undone + c.undone,
            restored: a.restored + c.restored,
            kept: a.kept + c.kept,
            added: a.added + c.added,
          }),
          ZERO,
        ),
      };
    }),
  ).filter((r) => r.takes > 0);
  return { reviewedTakes: snapshots.length, missed, rows };
}

/** A rate as a whole percent, or null when there is nothing to divide by or too few takes. */
export function cutRate(part: number, whole: number, takes: number): number | null {
  return takes < CUT_QUALITY_MIN_TAKES || whole === 0 ? null : Math.round((part / whole) * 100);
}

/** The "Missed something?" mark (spec 0017 AC-3): at most this many are recorded per take per UTC day. */
export const MISSED_MARK = { perTakePerDay: 20 } as const;
