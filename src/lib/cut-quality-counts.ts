import { CUT_KINDS, CUT_PROPOSERS, type CutKind, type CutProposer } from "./cuts";
import type { ExpectedSpan, ScoredCut } from "./cut-quality-case";
import { isHit, settleEither, union } from "./cut-quality-score";

/** /insights shows "too few takes" below this many reviewed takes (spec 0017 AC-5). */
export const CUT_QUALITY_MIN_TAKES = 5;

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

/** A marked span named by its time and kind only. */
export type SpanRef = { readonly startMs: number; readonly endMs: number; readonly kind: CutKind };

/**
 * Which marked spans a pipeline got wrong, by the same 60% rule as `scoreCuts`: the must cut
 * spans it missed, and the keep spans it cut. Times and kinds only, no words.
 */
export function missesOf(
  allExpected: readonly ExpectedSpan[],
  actual: readonly ScoredCut[],
): { readonly missed: readonly SpanRef[]; readonly wrongKeeps: readonly SpanRef[] } {
  const expected = settleEither(allExpected, actual);
  const cutAll = union(actual);
  const ref = (e: ExpectedSpan): SpanRef => ({ startMs: e.startMs, endMs: e.endMs, kind: e.kind });
  return {
    missed: expected.filter((e) => e.verdict === "cut" && !isHit(e, cutAll)).map(ref),
    wrongKeeps: expected.filter((e) => e.verdict === "keep" && isHit(e, cutAll)).map(ref),
  };
}
