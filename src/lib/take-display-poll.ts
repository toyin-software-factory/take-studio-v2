import { isInFlight } from "./take-display-status";

/** Poll intervals (spec 0004, Flow step 7, AC-8). */
export const POLL = {
  takeMs: 2000,
  /** A ready take that nothing is changing: a slow check that finds a change made elsewhere. */
  idleMs: 15_000,
  cardMs: 5000,
  maxBackoffMs: 10_000,
} as const;

/** Next delay after `failures` errors in a row: the base, doubling, capped at 10 s. */
export function pollDelay(baseMs: number, failures: number): number {
  // The cap never lowers a base that is already above it (the idle check, `POLL.idleMs`).
  return Math.min(baseMs * 2 ** failures, Math.max(POLL.maxBackoffMs, baseMs));
}

/** True while a background change is queued or running (the take itself stays Ready). */
export function backgroundChangeActive(
  job: { readonly status: string } | null | undefined,
): boolean {
  return job?.status === "queued" || job?.status === "running";
}

/** What the take page says about a background change that failed (spec 0008, AC-5). */
export function backgroundFailureMessage(failureCode: string | null): string {
  return failureCode === "background_missing"
    ? "That background isn't available any more. Pick another one."
    : "The new background didn't finish. Your video is unchanged. Try again.";
}

/** The note shown when the take has no usable green screen (spec 0008, AC-3). */
export const NO_GREEN_SCREEN_NOTE =
  "We couldn't find a green screen in this take, so we kept the original background.";

/**
 * True while the take page keeps checking the take: while it is uploading or processing, while a
 * background change runs, and, slowly, while it is ready (so a second tab sees a change finished
 * in the first). A failed or expired take is final.
 */
export function keepPolling(detail: {
  readonly take: { readonly status: string; readonly expired: boolean };
  readonly backgroundJob?: { readonly status: string } | null;
}): boolean {
  if (isInFlight(detail.take.status) || backgroundChangeActive(detail.backgroundJob)) return true;
  return detail.take.status === "ready" && !detail.take.expired;
}

/**
 * The line on the stage while a still preview covers the video (S3S-T14, spec 0011): it says the
 * picture is a still, not a video, and that the pending bar's Render makes it.
 */
export function previewStatusText(preview: { readonly kind: "making" | "image" }): string {
  if (preview.kind === "making") return "Making a still preview. Your video is paused.";
  return "Still preview, not a video. Press \u201cRender\u201d to make it.";
}
