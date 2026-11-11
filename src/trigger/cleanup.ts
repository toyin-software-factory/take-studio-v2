import { logger, schedules } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { expireDueTakes, failAbandonedUploads, failStaleJobs } from "@/db/data/cleanup";
import { parseJobEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { cancelRuns } from "@/lib/trigger-runs";
import { storageDeletionTask } from "./storage-deletion";

/**
 * Scheduled cleanup every 15 minutes (spec 0002, AC-18):
 * 1. fail abandoned uploads (`upload_abandoned`) and abort their multipart uploads;
 * 2. fail stuck jobs with the refundable `stale_run` (and cancel their runs);
 * 3. expire takes past `video_expires_at`, queuing their video files;
 * 4. drain the file deletion queue.
 * Each step handles a batch; the next run continues. Logs counts and IDs only.
 */
export const cleanupTask = schedules.task({
  id: "cleanup",
  // A short window: Trigger.dev's default (60 min) could delay a 15 minute cleanup by an hour.
  cron: { pattern: "*/15 * * * *", timezone: "UTC", window: "2m" },
  machine: "small-1x",
  maxDuration: 600,
  run: async (payload) => {
    const env = parseJobEnv();
    const r2 = createR2(env);
    const now = payload.timestamp;

    const summary = await withJobDb(env.DATABASE_URL, async (db) => {
      const abandoned = await failAbandonedUploads(db, now);
      let abortFailures = 0;
      for (const upload of abandoned) {
        if (upload.uploadId === null) continue;
        try {
          await r2.abortMultipartUpload(upload.originalKey, upload.uploadId);
        } catch {
          // R2 lifecycle rules (feature 11) are the backstop for orphaned parts.
          abortFailures++;
          logger.warn("multipart abort failed", { takeId: upload.takeId });
        }
      }

      const stale = await failStaleJobs(db, now);
      const cancelled = await cancelRuns(stale.flatMap(({ runId }) => (runId ? [runId] : [])));

      const expiry = await expireDueTakes(db, now);
      return {
        abandonedUploads: abandoned.length,
        abortFailures,
        staleJobs: stale.length,
        staleRunsCancelled: cancelled,
        refundedSeconds: stale.reduce((sum, job) => sum + job.refundedSeconds, 0),
        expiredTakes: expiry.expired,
        queuedKeys: expiry.queuedKeys,
      };
    });

    const drain = await storageDeletionTask.triggerAndWait();
    const result = { ...summary, drained: drain.ok ? drain.output : null };
    logger.info("cleanup finished", result);
    return result;
  },
});
