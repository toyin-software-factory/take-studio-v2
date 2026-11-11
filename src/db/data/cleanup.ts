import { and, asc, eq, inArray, isNotNull, lt, lte, or } from "drizzle-orm";
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
 * `upload_abandoned`, clears their upload ID and queues the original key (a completed but
 * never confirmed upload would otherwise linger). Returns what to abort in R2.
 */
export async function failAbandonedUploads(
  db: Executor,
  now: Date,
): Promise<readonly AbandonedUpload[]> {
  const { abandonedUploadBefore } = cleanupCutoffs(now);
  const candidates = await db
    .select({ id: take.id, originalKey: take.originalKey, uploadId: take.uploadId })
    .from(take)
    .where(and(eq(take.status, "uploading"), lt(take.createdAt, abandonedUploadBefore)))
    .orderBy(asc(take.createdAt))
    .limit(CLEANUP.batchSize);

  const failed: AbandonedUpload[] = [];
  for (const candidate of candidates) {
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
  readonly refundedSeconds: number;
  /** Trigger.dev run to cancel, when known. */
  readonly runId: string | null;
};

/**
 * Fails jobs that are stuck with the refundable `stale_run`: `queued` for longer than the
 * pick up window, or `running` past the task's maxDuration plus a margin. Uses `jobs.finish`,
 * so the take moves and the refund happens exactly as for any other failure.
 */
export async function failStaleJobs(db: Executor, now: Date): Promise<readonly StaleJob[]> {
  const { queuedJobBefore, runningJobBefore } = cleanupCutoffs(now);
  const candidates = await db
    .select({ id: processingJob.id })
    .from(processingJob)
    .where(
      or(
        and(eq(processingJob.status, "queued"), lt(processingJob.createdAt, queuedJobBefore)),
        and(
          eq(processingJob.status, "running"),
          isNotNull(processingJob.startedAt),
          lt(processingJob.startedAt, runningJobBefore),
        ),
      ),
    )
    .orderBy(asc(processingJob.createdAt))
    .limit(CLEANUP.batchSize);

  const failed: StaleJob[] = [];
  for (const { id } of candidates) {
    const result = await finish(db, { jobId: id, status: "failed", failureCode: "stale_run", now });
    // `already_final`: it finished on its own meanwhile.
    if (result.ok) {
      failed.push({
        jobId: id,
        refundedSeconds: result.data.refundedSeconds,
        runId: result.data.job.triggerRunId,
      });
    }
  }
  return failed;
}

/**
 * Expires takes whose `video_expires_at` has passed (AC-18). `processing` takes are skipped
 * and picked up by a later sweep once their job ends.
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
