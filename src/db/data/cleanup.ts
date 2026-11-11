import { and, asc, eq, inArray, isNotNull, lt, lte, ne, notExists, or, sql } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { CLEANUP, cleanupCutoffs } from "@/lib/cleanup-rules";
import { processingJob, take } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";
import { expireTake } from "./deletion";
import { finish, queueDeletions } from "./jobs";
import { transitionTake } from "./takes";

/**
 * The scheduled cleanup's steps (spec 0002, AC-18). Each handles at most a batch per run and
 * takes rows one transaction at a time, so a failure on one row never blocks the rest.
 * Job safe: IDs only.
 */

export type AbandonedUpload = {
  readonly takeId: string;
  readonly originalKey: string;
  /** Multipart upload to abort, when one was started. */
  readonly uploadId: string | null;
};

/**
 * Fails `uploading` takes older than the upload link lifetime plus a margin with
 * `upload_abandoned`, clears their upload ID and queues the original key. Before each one it
 * checks storage itself (`headObject`): a take whose original is stored at the stated size
 * belongs to the stuck upload recovery and is never failed here, and a take whose storage
 * cannot be checked is left for the next run. No run local list stands in for that check, so
 * overlapping runs and the recovery batch limit cannot make a stored original look absent.
 * Returns what to abort in R2.
 */
export async function failAbandonedUploads(
  db: Executor,
  now: Date,
  headObject: StuckUploadPorts["headObject"],
  scan: ScanBudget = {},
): Promise<readonly AbandonedUpload[]> {
  const clock = scan.clock ?? Date.now;
  const stopAt = clock() + (scan.budgetMs ?? DEFAULT_SCAN_BUDGET_MS);
  const { abandonedUploadBefore } = cleanupCutoffs(now);
  const candidates = await db
    .select({
      id: take.id,
      originalKey: take.originalKey,
      originalBytes: take.originalBytes,
      uploadId: take.uploadId,
    })
    .from(take)
    .where(and(eq(take.status, "uploading"), lt(take.createdAt, abandonedUploadBefore)))
    .orderBy(asc(take.updatedAt))
    .limit(CLEANUP.batchSize);

  const failed: AbandonedUpload[] = [];
  for (const candidate of candidates) {
    if (clock() >= stopAt) break; // out of time budget: the next run continues
    try {
      const stored = await headObject(candidate.originalKey);
      if (stored && stored.size === Number(candidate.originalBytes)) continue; // recovery's
    } catch {
      // Cannot tell: try again later rather than delete a stored original, behind the rest.
      await backOff(db, candidate.id, now);
      continue;
    }
    const result = await runTx(db, async (tx) => {
      const moved = await transitionTake(tx, candidate.id, "uploading", "failed", {
        failureCode: "upload_abandoned",
        uploadId: null,
      });
      if (moved.ok) await queueDeletions(tx, [candidate.originalKey]);
      return moved;
    });
    // Not ok means the upload completed meanwhile: leave it.
    if (result.ok) {
      failed.push({
        takeId: candidate.id,
        originalKey: candidate.originalKey,
        uploadId: candidate.uploadId,
      });
    }
  }
  return failed;
}

export type StaleJob = {
  readonly jobId: string;
  /** The job's kind: `transcribe` jobs never send the take email (spec 0007). */
  readonly kind: string;
  readonly refundedSeconds: number;
  /** Trigger.dev run to cancel, when known. */
  readonly runId: string | null;
};

/**
 * Fails jobs that are stuck with the refundable `stale_run`: `queued` for longer than the
 * pick up window, or `running` past the task's maxDuration plus a margin (each kind has its own:
 * a `transcribe` job is stale after 50 minutes, the video kinds after 85). Uses `jobs.finish`,
 * so the take moves and the refund happens exactly as for any other failure.
 */
export async function failStaleJobs(db: Executor, now: Date): Promise<readonly StaleJob[]> {
  const { queuedJobBefore, runningJobBefore, transcribeRunningJobBefore } = cleanupCutoffs(now);
  const candidates = await db
    .select({ id: processingJob.id, kind: processingJob.kind })
    .from(processingJob)
    .where(
      or(
        and(eq(processingJob.status, "queued"), lt(processingJob.createdAt, queuedJobBefore)),
        and(
          eq(processingJob.status, "running"),
          ne(processingJob.kind, "transcribe"),
          isNotNull(processingJob.startedAt),
          lt(processingJob.startedAt, runningJobBefore),
        ),
        and(
          eq(processingJob.status, "running"),
          eq(processingJob.kind, "transcribe"),
          isNotNull(processingJob.startedAt),
          lt(processingJob.startedAt, transcribeRunningJobBefore),
        ),
      ),
    )
    .orderBy(asc(processingJob.createdAt))
    .limit(CLEANUP.batchSize);

  const failed: StaleJob[] = [];
  for (const { id, kind } of candidates) {
    const result = await finish(db, { jobId: id, status: "failed", failureCode: "stale_run", now });
    // `already_final`: it finished on its own meanwhile.
    if (result.ok) {
      failed.push({
        jobId: id,
        kind,
        refundedSeconds: result.data.refundedSeconds,
        runId: result.data.job.triggerRunId,
      });
    }
  }
  return failed;
}

/**
 * Expires takes whose `video_expires_at` has passed (AC-18). `processing` takes are skipped
 * and picked up by a later sweep once their job ends, and so is any take with an active job of
 * any kind (a `transcribe` job leaves the take `ready`, spec 0007).
 */
export async function expireDueTakes(
  db: Executor,
  now: Date,
): Promise<{ readonly expired: number; readonly queuedKeys: number }> {
  const due = await db
    .select({ id: take.id })
    .from(take)
    .where(
      and(
        inArray(take.status, ["uploaded", "ready", "failed"]),
        isNotNull(take.videoExpiresAt),
        lte(take.videoExpiresAt, now),
        notExists(
          db
            .select({ one: sql`1` })
            .from(processingJob)
            .where(
              and(
                eq(processingJob.takeId, take.id),
                inArray(processingJob.status, ACTIVE_JOB_STATUSES),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(take.videoExpiresAt))
    .limit(CLEANUP.batchSize);

  let expired = 0;
  let queuedKeys = 0;
  for (const { id } of due) {
    const result = await expireTake(db, { takeId: id });
    if (result.ok) {
      expired++;
      queuedKeys += result.data.queuedKeys.length;
    }
  }
  return { expired, queuedKeys };
}

/** Bounds for the storage scans, so slow R2 calls cannot use up the whole cleanup run. */
export type ScanBudget = {
  /** Stop starting storage checks after this long (default 2 minutes). */
  readonly budgetMs?: number;
  /** Clock for the budget (tests). */
  readonly clock?: () => number;
};
const DEFAULT_SCAN_BUDGET_MS = 2 * 60 * 1000;

/**
 * A storage check failed: move the take to the back of the queue (`updated_at` is the sort key
 * of both scans) so persistent HEAD errors on the oldest rows cannot starve later ones.
 */
async function backOff(db: Executor, takeId: string, now: Date): Promise<void> {
  await db
    .update(take)
    .set({ updatedAt: now })
    .where(and(eq(take.id, takeId), eq(take.status, "uploading")));
}

export type StuckUploadPorts = {
  /** R2 HEAD of the original: its size, or null when the object does not exist. */
  readonly headObject: (key: string) => Promise<{ readonly size: number } | null>;
  /** Triggers the probe with key `probe-{takeId}-{redispatch}` (`probeKey`). */
  readonly dispatchProbe: (takeId: string, redispatch: number) => Promise<void>;
};

export type StuckUploadRecovery = {
  /** Takes whose probe was dispatched again (attempt number in `redispatchCount`). */
  readonly redispatched: readonly string[];
  /** Takes failed with `internal_error` after the last re-dispatch. */
  readonly failed: readonly string[];
};

/**
 * Recovers takes stuck in `uploading` after the probe dispatch failed (S1C-T09). `/complete`
 * stored the original but the probe never ran, so the take waits and the client's delete gets
 * a 409. A take counts when it is `uploading`, quiet for `stuckProbeAfterMs` (`updated_at`,
 * which each re-dispatch bumps) and its original exists in R2 at the stated size; an upload
 * that never completed has no object and stays with the abandoned rule.
 *
 * Each pass re-dispatches the probe once with a fresh idempotency key and counts it in
 * `take.probe_attempts` (compare and swap, so two runs never both count). After
 * `maxProbeRedispatches` re-dispatches the next pass fails the take with the refundable
 * `internal_error` and queues the original. Nothing is charged before the probe, so there is
 * nothing to refund. A probe that is just slow can be dispatched twice: the probe is safe to
 * rerun (each step checks the take's state, and the job start is guarded).
 */
export async function recoverStuckUploads(
  db: Executor,
  now: Date,
  ports: StuckUploadPorts,
  scan: ScanBudget = {},
): Promise<StuckUploadRecovery> {
  const clock = scan.clock ?? Date.now;
  const stopAt = clock() + (scan.budgetMs ?? DEFAULT_SCAN_BUDGET_MS);
  const quietBefore = new Date(now.getTime() - CLEANUP.stuckProbeAfterMs);
  const candidates = await db
    .select({
      id: take.id,
      originalKey: take.originalKey,
      originalBytes: take.originalBytes,
      attempts: take.probeAttempts,
      updatedAt: take.updatedAt,
    })
    .from(take)
    .where(and(eq(take.status, "uploading"), lt(take.updatedAt, quietBefore)))
    .orderBy(asc(take.updatedAt))
    .limit(CLEANUP.batchSize);

  const redispatched: string[] = [];
  const failed: string[] = [];
  for (const candidate of candidates) {
    if (clock() >= stopAt) break; // out of time budget: the next run continues
    let stored: { readonly size: number } | null;
    try {
      stored = await ports.headObject(candidate.originalKey);
    } catch {
      // Could not check: leave it, and move it behind the others so it cannot starve them.
      await backOff(db, candidate.id, now);
      continue;
    }
    if (!stored || stored.size !== Number(candidate.originalBytes)) continue;

    if (candidate.attempts >= CLEANUP.maxProbeRedispatches) {
      // The last dispatched probe may still be queued or retrying: protect the take (and its
      // original) until that run can no longer be active.
      const failBefore = new Date(now.getTime() - CLEANUP.lastProbeGraceMs);
      if (candidate.updatedAt.getTime() >= failBefore.getTime()) continue;
      const result = await runTx(db, async (tx) => {
        const moved = await transitionTake(tx, candidate.id, "uploading", "failed", {
          failureCode: "internal_error",
          uploadId: null,
        });
        if (moved.ok) await queueDeletions(tx, [candidate.originalKey]);
        return moved;
      });
      if (result.ok) failed.push(candidate.id);
      continue;
    }

    const next = candidate.attempts + 1;
    const [counted] = await db
      .update(take)
      .set({ probeAttempts: next })
      .where(
        and(
          eq(take.id, candidate.id),
          eq(take.status, "uploading"),
          eq(take.probeAttempts, candidate.attempts),
        ),
      )
      .returning({ id: take.id });
    if (!counted) continue; // another run or the probe got there first
    try {
      await ports.dispatchProbe(candidate.id, next);
    } catch {
      // Counted anyway: the attempts are bounded, and the next pass tries again.
    }
    redispatched.push(candidate.id);
  }
  return { redispatched, failed };
}
