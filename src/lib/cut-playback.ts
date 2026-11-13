import type { Range } from "./cut-rules";

/**
 * Pure playback maps for the cut review timeline (spec 0011, AC-3). Ranges are removed spans of
 * the original, sorted, non overlapping (merge them with `effectiveRemovedRanges` first). Times
 * are milliseconds.
 */

/** Position on a video with `ranges` cut out → position on the original. */
export function outputToOriginal(outputMs: number, ranges: readonly Range[]): number {
  let original = outputMs;
  for (const r of ranges) {
    if (r.startMs <= original) original += r.endMs - r.startMs;
    else break;
  }
  return original;
}

/** Position on the original → position on a video with `ranges` cut out (inside a cut: its start). */
export function originalToOutput(originalMs: number, ranges: readonly Range[]): number {
  let removed = 0;
  for (const r of ranges) {
    if (originalMs >= r.endMs) removed += r.endMs - r.startMs;
    else if (originalMs > r.startMs) removed += originalMs - r.startMs;
    else break;
  }
  return originalMs - removed;
}

/** Where to jump when playing the original and `ms` sits inside a removed range, else null. */
export function skipTarget(ms: number, ranges: readonly Range[]): number | null {
  const hit = ranges.find((r) => ms >= r.startMs && ms < r.endMs);
  return hit ? hit.endMs : null;
}

/** Total length removed. */
export function removedTotalMs(ranges: readonly Range[]): number {
  return ranges.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
}

/** Length of the previewed video: original minus removed. */
export function pendingTotalMs(durationMs: number, ranges: readonly Range[]): number {
  return Math.max(0, durationMs - removedTotalMs(ranges));
}

/** End of the last kept range of the original (where preview playback stops). */
export function playEnd(ranges: readonly Range[], durationMs: number): number {
  const last = ranges.at(-1);
  return last && last.endMs >= durationMs ? last.startMs : durationMs;
}
