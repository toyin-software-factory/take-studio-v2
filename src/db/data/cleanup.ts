import { and, asc, eq, inArray, isNotNull, lte, notExists, sql } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { CLEANUP } from "@/lib/cleanup-rules";
import { processingJob, take } from "../schema";
import type { Executor } from "../types";
import { expireTake } from "./deletion";

/**
 * The scheduled cleanup's steps (spec 0002, AC-18). Each handles at most a batch per run and
 * takes rows one transaction at a time, so a failure on one row never blocks the rest.
 * Job safe: IDs only.
 */

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

// Split by job (B2-T117): the upload steps are in `cleanup-uploads`, the stuck job step in
// `cleanup-jobs`. This file keeps the import path stable.
export {
  failAbandonedUploads,
  recoverStuckUploads,
  type AbandonedUpload,
  type ScanBudget,
  type StuckUploadPorts,
  type StuckUploadRecovery,
} from "./cleanup-uploads";
export { failStaleJobs, type StaleJob } from "./cleanup-jobs";
