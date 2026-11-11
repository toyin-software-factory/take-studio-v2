/**
 * Timing for deletion and cleanup (spec 0002, AC-17, AC-18). Sensible defaults for slice 1;
 * the slice 1 spec owns the final upload link lifetime and the processing task's
 * maxDuration, and changes them here.
 */

const MINUTE = 60 * 1000;

export const CLEANUP = {
  /** How long a presigned upload link stays valid. */
  uploadLinkLifetimeMs: 60 * MINUTE,
  /** Extra time after the link expires before an `uploading` take counts as abandoned. */
  uploadAbandonMarginMs: 15 * MINUTE,
  /** A job still `queued` after this was never picked up. */
  queuedStaleMs: 15 * MINUTE,
  /** The processing task's maxDuration (trigger.config.ts `maxDuration` is 1800 s). */
  jobMaxDurationMs: 30 * MINUTE,
  /** Extra time after maxDuration before a `running` job counts as stale. */
  runningStaleMarginMs: 5 * MINUTE,
  /**
   * An `uploading` take whose original is stored (the upload completed) but that was never
   * probed is re-dispatched once it has been quiet this long (S1C-T09).
   */
  stuckProbeAfterMs: 5 * MINUTE,
  /** Re-dispatches of the probe for one take before it fails with `internal_error`. */
  maxProbeRedispatches: 3,
  /** Rows handled per cleanup step per run (the next run picks up the rest). */
  batchSize: 100,
} as const;

export const STORAGE_DELETION = {
  /** Queue rows claimed per drain batch. */
  batchSize: 50,
  /** After this many failed attempts a row is left for a person to look at. */
  maxAttempts: 10,
} as const;

/** Cut off times for this cleanup run, from `now`. */
export function cleanupCutoffs(now: Date) {
  const at = now.getTime();
  return {
    /** `uploading` takes created before this are abandoned. */
    abandonedUploadBefore: new Date(
      at - CLEANUP.uploadLinkLifetimeMs - CLEANUP.uploadAbandonMarginMs,
    ),
    /** `queued` jobs created before this are stale. */
    queuedJobBefore: new Date(at - CLEANUP.queuedStaleMs),
    /** `running` jobs started before this are stale. */
    runningJobBefore: new Date(at - CLEANUP.jobMaxDurationMs - CLEANUP.runningStaleMarginMs),
  };
}
