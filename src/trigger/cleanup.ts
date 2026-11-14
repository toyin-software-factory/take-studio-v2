import { logger, schedules } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { purgeOldAnalyticsEvents, repairAnalyticsEvents } from "@/db/data/analytics-repair";
import { purgeOldRateWindows } from "@/db/data/api-keys";
import { failStuckBackgrounds, purgeRemovedBackgrounds } from "@/db/data/backgrounds";
import {
  expireDueTakes,
  failAbandonedUploads,
  failStaleJobs,
  recoverStuckUploads,
} from "@/db/data/cleanup";
import { parseJobEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { cancelRuns, isRunAlive, isRunWaiting, triggerProbe } from "@/lib/trigger-runs";
import { storageDeletionTask } from "./storage-deletion";
import { queueTakeEmail } from "./email/queue";
import { ensureBuiltInBackgrounds } from "./built-in-backgrounds";

/**
 * Scheduled cleanup every 15 minutes (spec 0002, AC-18):
 * 0. recover takes stuck in `uploading` whose original is stored but never probed (S1C-T09):
 *    dispatch the probe again with a fresh key; after 3 re-dispatches fail them (`internal_error`);
 * 1. fail abandoned uploads (`upload_abandoned`) and abort their multipart uploads (each one is
 *    checked against storage first: a stored original is never abandoned);
 * 2. fail stuck jobs with the refundable `stale_run` (and cancel their runs); a `queued` job whose
 *    run is still waiting in Trigger.dev's queue (a creator's concurrency limit) is not stale;
 * 3. expire takes past `video_expires_at`, queuing their video files;
 * 4. drain the file deletion queue;
 * 4b. product events (spec 0016): insert the milestone events a dropped insert missed (the real
 *    rows' own times) and purge repeatable events older than 13 months; a failure is logged and
 *    never stops the sweep;
 * 4c. API rate windows (spec 0018 AC-9): delete the ones older than an hour; a failure is logged and
 *    never stops the sweep;
 * 5. first of all, install the built in studio backgrounds (spec 0008, AC-7; idempotent and cheap
 *    when they are all there; a failure is logged and never stops the sweep).
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
      // Always the live set: the test only placeholder must never reach a live database.
      const studiosInstalled = await ensureBuiltInBackgrounds(db, r2, { local: false }).catch(
        (error: unknown) => {
          logger.error("built in studios not installed", {
            error: error instanceof Error ? error.name : "unknown",
          });
          return 0;
        },
      );
      const recovery = await recoverStuckUploads(db, now, {
        headObject: (key) => r2.headObject(key),
        dispatchProbe: triggerProbe,
      });
      const abandoned = await failAbandonedUploads(db, now, (key) => r2.headObject(key));
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

      // A queued job whose run still waits (behind its creator's limit) is left alone.
      const stale = await failStaleJobs(db, now, isRunWaiting, isRunAlive);
      // AC-5: a job the sweep failed still owes its creator the "didn't finish" email.
      for (const job of stale) await queueTakeEmail(job.jobId, job.kind);
      const cancelled = await cancelRuns(stale.flatMap(({ runId }) => (runId ? [runId] : [])));

      const expiry = await expireDueTakes(db, now);
      // Spec 0008: uploaded backgrounds that never finished (an hour) are failed, files queued.
      const stuckBackgrounds = await failStuckBackgrounds(db, now);
      // And the deleted ones kept hidden while their upload link could still be live.
      const purgedBackgrounds = await purgeRemovedBackgrounds(db, now);
      // Spec 0016 AC-6 and AC-9: repair what a dropped insert missed, purge what has expired.
      const analytics = await Promise.all([
        repairAnalyticsEvents(db),
        purgeOldAnalyticsEvents(db, now),
      ]).then(
        ([repaired, purged]) => ({ repaired, purged }),
        (error: unknown) => {
          logger.error("analytics repair failed", {
            error: error instanceof Error ? error.name : "unknown",
          });
          return null;
        },
      );
      // Spec 0018 AC-9: the limit only reads the current minute, so old windows can go.
      const rateWindowsPurged = await purgeOldRateWindows(db, now).catch((error: unknown) => {
        logger.error("rate window purge failed", {
          error: error instanceof Error ? error.name : "unknown",
        });
        return null;
      });
      return {
        analytics,
        rateWindowsPurged,
        studiosInstalled,
        probesRedispatched: recovery.redispatched.length,
        stuckUploadsFailed: recovery.failed.length,
        abandonedUploads: abandoned.length,
        abortFailures,
        staleJobs: stale.length,
        staleRunsCancelled: cancelled,
        refundedSeconds: stale.reduce((sum, job) => sum + job.refundedSeconds, 0),
        expiredTakes: expiry.expired,
        queuedKeys: expiry.queuedKeys,
        stuckBackgrounds,
        purgedBackgrounds,
      };
    });

    const drain = await storageDeletionTask.triggerAndWait();
    const result = { ...summary, drained: drain.ok ? drain.output : null };
    logger.info("cleanup finished", result);
    return result;
  },
});
