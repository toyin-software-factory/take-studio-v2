/**
 * Timing for deletion and cleanup (spec 0002, AC-17, AC-18). Sensible defaults for slice 1;
 * the slice 1 spec owns the final upload link lifetime and the processing task's
 * maxDuration, and changes them here.
 */

import { UPLOAD } from "./uploads";

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
  /**
   * Runs of `process-take` one creator can have at the same time (the queue's concurrency limit;
   * with a per creator `concurrencyKey` each creator gets a queue of this size). More jobs of the
   * same creator wait in the queue, and the others' jobs are not held up behind them.
   */
  perCreatorConcurrency: 2,
} as const;

/**
 * The transcribe task's limits (spec 0007), in one place like `PROCESS_TAKE_LIMITS`: the task
 * reads them for its own `maxDuration` and `retry`, and a running transcribe job is stale after
 * 3 x 15 minutes plus the margin (50 minutes), far sooner than a video job.
 */
export const TRANSCRIBE_TAKE_LIMITS = {
  /** `maxDuration` of one attempt, in seconds. */
  maxDurationSeconds: 15 * 60,
  /** `retry.maxAttempts`. */
  maxAttempts: 3,
} as const;

/** `ingest-background`'s limits (spec 0008): one image, a few seconds of ffmpeg. */
export const INGEST_BACKGROUND_LIMITS = {
  /** `maxDuration` of one attempt, in seconds. */
  maxDurationSeconds: 5 * 60,
  /** `retry.maxAttempts`. */
  maxAttempts: 3,
} as const;

/** The probe task's limits, shared by the task and the stuck upload recovery's grace period. */
export const PROBE_LIMITS = {
  /** `maxDuration` of one attempt, in seconds. */
  maxDurationSeconds: 300,
  /** `retry.maxAttempts`. */
  maxAttempts: 3,
} as const;

export const CLEANUP = {
  /**
   * An `uploading` take is abandoned once nothing has touched it for this long: the part link
   * lifetime plus a margin. A browser that is still sending asks for fresh part links at least
   * that often (each link lasts `UPLOAD.partLinkSeconds`), and every request touches
   * `take.updated_at`, so a slow upload that keeps progressing is never failed.
   */
  uploadIdleMs: UPLOAD.partLinkSeconds * 1000 + 15 * MINUTE,
  /** The hard stop: an upload still `uploading` this long after it was created is failed. */
  uploadBackstopMs: 6 * 60 * MINUTE,
  /** Part link requests touch `take.updated_at` at most this often. */
  uploadTouchEveryMs: MINUTE,
  /**
   * A job still `queued` after this may never have been picked up, so the cleanup asks Trigger.dev
   * about its run (a run that is still waiting, for instance behind its creator's concurrency
   * limit, is left alone). Without a run to ask about, it is stale at once.
   */
  queuedStaleMs: 15 * MINUTE,
  /**
   * The hard stop for a `queued` job whose run still looks alive: behind the per creator limit a
   * wait is at most a few full runs, so this is far past anything real (6 hours).
   */
  queuedBackstopMs: 6 * 60 * MINUTE,
  /**
   * Trigger.dev run lookups per sweep for queued jobs, and the time one may take (a lookup that
   * is slower counts as "still waiting"): together at most about two minutes of the 10 minute
   * cleanup task, so the expiry and deletion steps after it always get their time.
   */
  queuedRunChecksPerSweep: 25,
  runCheckTimeoutMs: 5_000,
  /**
   * How long a `running` job may legitimately last: every attempt can use the full
   * maxDuration, and a retry keeps the first attempt's `started_at`.
   */
  jobMaxDurationMs: PROCESS_TAKE_LIMITS.maxAttempts * PROCESS_TAKE_LIMITS.maxDurationSeconds * 1000,
  /**
   * The same for a `transcribe` job: its own limits, so one stuck there is found in minutes
   * instead of the video job's hour and a half.
   */
  transcribeJobMaxDurationMs:
    TRANSCRIBE_TAKE_LIMITS.maxAttempts * TRANSCRIBE_TAKE_LIMITS.maxDurationSeconds * 1000,
  /**
   * The hard stop for a `running` job whose run still looks alive, from `started_at` (6 hours):
   * past it the job is failed whatever Trigger.dev says.
   */
  runningBackstopMs: 6 * 60 * MINUTE,
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

/**
 * Whether a probe run may fail its take: only the newest dispatch owns it. `redispatch` is the
 * run's own number (0 for the upload completion), `attempts` the take's `probe_attempts`.
 * An older run that fails after cleanup dispatched a newer one must leave the take alone.
 */
export function ownsTakeAfterFailure(redispatch: number | undefined, attempts: number): boolean {
  return (redispatch ?? 0) >= attempts;
}

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
    /** `uploading` takes last touched before this are abandoned (idle). */
    idleUploadBefore: new Date(at - CLEANUP.uploadIdleMs),
    /** `uploading` takes created before this are abandoned whatever their activity. */
    uploadBackstopBefore: new Date(at - CLEANUP.uploadBackstopMs),
    /** `queued` jobs created before this are stale. */
    queuedJobBefore: new Date(at - CLEANUP.queuedStaleMs),
    /** `queued` jobs created before this are failed even when their run still looks alive. */
    queuedBackstopBefore: new Date(at - CLEANUP.queuedBackstopMs),
    runningBackstopBefore: new Date(at - CLEANUP.runningBackstopMs),
    /** `running` jobs of the video kinds started before this are stale. */
    runningJobBefore: new Date(at - CLEANUP.jobMaxDurationMs - CLEANUP.runningStaleMarginMs),
    /** `running` `transcribe` jobs started before this are stale (spec 0007). */
    transcribeRunningJobBefore: new Date(
      at - CLEANUP.transcribeJobMaxDurationMs - CLEANUP.runningStaleMarginMs,
    ),
  };
}
