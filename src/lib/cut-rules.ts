import { CUT_REASON_MAX, type CutKind, type CutProposer } from "./cuts";

/**
 * Pure cut rules (spec 0002, AC-8, AC-9). Cut times are integer milliseconds of the
 * original upload. The database checks `0 ≤ start < end`; the take length and the no
 * overlap rule live here because they span rows.
 */

export type Range = { readonly startMs: number; readonly endMs: number };

/** A cut as the rules see it. `creatorChangedAt` null means the creator never touched it. */
export type CutLike = Range & {
  readonly id: string;
  readonly proposedBy: string;
  readonly creatorChangedAt: Date | null;
};

/** A cut proposed by the rules or the AI during (re) analysis. */
export type ProposedCut = Range & {
  readonly kind: Exclude<CutKind, "manual">;
  readonly proposedBy: Exclude<CutProposer, "creator">;
  readonly reason?: string | null;
};

/** True when `range` is whole milliseconds with `0 ≤ start < end ≤ durationMs`. */
export function isWithinTake(range: Range, durationMs: number): boolean {
  const { startMs, endMs } = range;
  return (
    Number.isInteger(startMs) &&
    Number.isInteger(endMs) &&
    startMs >= 0 &&
    startMs < endMs &&
    endMs <= durationMs
  );
}

/** Half open ranges overlap when each starts before the other ends (touching is fine). */
export function overlaps(a: Range, b: Range): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** True when `range` overlaps any of `others`. */
export function overlapsAny(range: Range, others: readonly Range[]): boolean {
  return others.some((other) => overlaps(range, other));
}

/** A cut the creator owns: they changed it, or they added it. Re analysis never replaces these. */
export function isCreatorOwned(cut: CutLike): boolean {
  return cut.creatorChangedAt !== null || cut.proposedBy === "creator";
}

/** Trims a reason to the stored maximum; empty becomes null. */
export function cleanReason(reason: string | null | undefined): string | null {
  const trimmed = (reason ?? "").trim();
  return trimmed === "" ? null : [...trimmed].slice(0, CUT_REASON_MAX).join("");
}

export type ReanalysePlan<P extends ProposedCut> = {
  /** IDs of untouched rules or AI cuts to delete. */
  readonly remove: readonly string[];
  /** Proposed cuts to insert, in start order. */
  readonly add: readonly P[];
  /** Proposed cuts dropped: out of range, or overlapping a kept cut or an earlier proposal. */
  readonly dropped: readonly P[];
};

/**
 * Plans a re analysis (AC-9): keeps every creator owned cut, replaces every untouched rules or
 * AI cut with the new proposals. A proposal that is out of range, or overlaps a kept cut or an
 * earlier proposal (by start time), is dropped so cuts never overlap.
 */
export function planReanalysis<P extends ProposedCut>(
  existing: readonly CutLike[],
  proposed: readonly P[],
  durationMs: number,
): ReanalysePlan<P> {
  const kept = existing.filter(isCreatorOwned);
  const remove = existing.filter((cut) => !isCreatorOwned(cut)).map((cut) => cut.id);

  const add: P[] = [];
  const dropped: P[] = [];
  const sorted = [...proposed].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (const cut of sorted) {
    const fits = isWithinTake(cut, durationMs) && !overlapsAny(cut, kept) && !overlapsAny(cut, add);
    (fits ? add : dropped).push(cut);
  }
  return { remove, add, dropped };
}

/** The removed ranges a render snapshots: applied cuts, in start order (AC-10). */
export function removedRanges(
  cuts: readonly (Range & { readonly applied: boolean })[],
): readonly Range[] {
  return cuts
    .filter((cut) => cut.applied)
    .map(({ startMs, endMs }) => ({ startMs, endMs }))
    .sort((a, b) => a.startMs - b.startMs);
}

/** One cut state change a change job carries (spec 0011): the cut and the state it ends in. */
export type CutPlanEntry = { readonly cutId: string; readonly applied: boolean };

/**
 * The removed ranges of a change render (spec 0011): every cut with `applied` taken from the
 * plan where the plan names it, else the stored flag; the applied ones in start order, with
 * ranges that touch or overlap merged into one. The render snapshot and the start check both use
 * this, so what is checked is what is rendered. A null or empty plan gives the stored state.
 */
export function effectiveRemovedRanges(
  cuts: readonly (Range & { readonly id: string; readonly applied: boolean })[],
  plan: readonly CutPlanEntry[] | null,
): readonly Range[] {
  const planned = new Map((plan ?? []).map((entry) => [entry.cutId, entry.applied]));
  const sorted = removedRanges(
    cuts.map((c) => ({ ...c, applied: planned.get(c.id) ?? c.applied })),
  );
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.startMs <= last.endMs) {
      merged[merged.length - 1] = {
        startMs: last.startMs,
        endMs: Math.max(last.endMs, range.endMs),
      };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** True when `a` and `b` are the same ranges in the same order. */
export function sameRanges(a: readonly Range[], b: readonly Range[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.startMs === b[i]?.startMs && r.endMs === b[i]?.endMs)
  );
}

/** A render's video key: `renders/{takeId}/{renderId}.mp4` (spec 0002, Value sourcing). */
export function renderKey(takeId: string, renderId: string): string {
  return `renders/${takeId}/${renderId}.mp4`;
}
