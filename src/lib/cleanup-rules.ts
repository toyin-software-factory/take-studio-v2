/**
 * Timing for deletion and cleanup (spec 0002, AC-17, AC-18). Sensible defaults for slice 1;
 * the slice 1 spec owns the final upload link lifetime and the processing task's
 * maxDuration, and changes them here.
 */

const MINUTE = 60 * 1000;

/**
 * The processing task's limits, in one place: `process-take` reads them for its own
 * `maxDuration` and `retry`, and the stale job cut off below is derived from them, so the two
 * can never disagree again.
 */
export const PROCESS_TAKE_LIMITS = {
  /** `maxDuration` of one attempt, in seconds. */
  maxDurationSeconds: 40 * 60,
  /** `retry.maxAttempts`. */
  maxAttempts: 2,
} as const;

/** The probe task's limits, shared by the task and the stuck upload recovery's grace period. */
export const PROBE_LIMITS = {
  /** `maxDuration` of one attempt, in seconds. */
  maxDurationSeconds: 300,
  /** `retry.maxAttempts`. */
  maxAttempts: 3,
} as const;

export const CLEANUP = {
  /** How long a presigned upload link stays valid. */
  uploadLinkLifetimeMs: 60 * MINUTE,
  /** Extra time after the link expires before an `uploading` take counts as abandoned. */
  uploadAbandonMarginMs: 15 * MINUTE,
  /** A job still `queued` after this was never picked up. */
  queuedStaleMs: 15 * MINUTE,
  /**
   * How long a `running` job may legitimately last: every attempt can use the full
   * maxDuration, and a retry keeps the first attempt's `started_at`.
   */
  jobMaxDurationMs: PROCESS_TAKE_LIMITS.maxAttempts * PROCESS_TAKE_LIMITS.maxDurationSeconds * 1000,
  /** Extra time after that (retry back off, queue time) before a `running` job counts as stale. */
  runningStaleMarginMs: 5 * MINUTE,
  /**
   * An `uploading` take whose original is stored (the upload completed) but that was never
   * probed is re-dispatched once it has been quiet this long (S1C-T09).
   */
  stuckProbeAfterMs: 5 * MINUTE,
  /** Re-dispatches of the probe for one take before it fails with `internal_error`. */
  maxProbeRedispatches: 3,
  /**
   * After the last re-dispatch a take is failed only once it has been quiet this long: the
   * dispatched probe may still be queued or retrying (every attempt of it can use maxDuration).
   */
  lastProbeGraceMs: PROBE_LIMITS.maxAttempts * PROBE_LIMITS.maxDurationSeconds * 1000 + 5 * MINUTE,
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
