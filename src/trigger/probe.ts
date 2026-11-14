import { logger, task } from "@trigger.dev/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { withJobDb } from "@/db/client/job";
import { dispatchJob } from "@/db/data/dispatch";
import { queueDeletions, startJob } from "@/db/data/jobs";
import { markUploaded, transitionTake } from "@/db/data/takes";
import { processingJob, take } from "@/db/schema";
import type { Db } from "@/db/types";
import { parseJobEnv, parseUsageEnv } from "@/lib/env";
import { PROBE_LIMITS, ownsTakeAfterFailure } from "@/lib/cleanup-rules";
import { createR2 } from "@/lib/r2";
import { thumbnailKey } from "@/lib/take-rules";
import { triggerForJob } from "@/lib/trigger-runs";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { recordJobEvent, recordTakeFailed } from "./analytics/record";
import { MediaToolError, probeUrl, thumbnailFromUrl } from "./media";
import { queueTakeEmail } from "./email/queue";

/**
 * `probe` (spec 0004, Flow step 4; AC-4). Dispatched by upload completion with the key
 * `probe-{takeId}`; the payload carries the take ID only.
 *
 * 1. ffprobe the original over a presigned GET (range reads, so `moov` at the end works).
 * 2. Write a thumbnail (`originals/{takeId}/thumb.jpg`); failure is not fatal.
 * 3. `markUploaded`: `uploaded` within the limits, else `failed` with the media code.
 * 4. For an uploaded take, start the job as the take's creator and dispatch `process-take`.
 * Safe to rerun: each step checks the take's state first. A missing take is a clean abort.
 * If the run fails for good, `onFailure` fails a still uploading take with `internal_error`.
 */
const PROBE_ATTEMPTS = PROBE_LIMITS.maxAttempts;

export const probeTask = task({
  id: "probe",
  machine: "small-2x",
  maxDuration: PROBE_LIMITS.maxDurationSeconds,
  retry: { maxAttempts: PROBE_ATTEMPTS },
  run: async (payload: { readonly takeId: string; readonly redispatch?: number }, { ctx }) => {
    const env = parseJobEnv();
    const { USAGE_HASH_SECRET: usageSecret } = parseUsageEnv();
    const r2 = createR2(env);

    return withJobDb(env.DATABASE_URL, async (db) => {
      const [found] = await db.select().from(take).where(eq(take.id, payload.takeId));
      if (!found) {
        logger.info("probe: take is gone, nothing to do", { takeId: payload.takeId });
        return { takeId: payload.takeId, outcome: "missing" as const };
      }

      if (found.status === "uploading") {
        const url = await r2.presignGet(found.originalKey, { expiresSeconds: 10 * 60 });
        let facts: Awaited<ReturnType<typeof probeUrl>> | null = null;
        try {
          facts = await probeUrl(url);
        } catch (error) {
          // A timeout or a flaky read must not mark good media as bad. Timeouts retry via
          // Trigger.dev. A read failure is tried once more here (dev has no run retries);
          // only a repeat failure on the last attempt (or in dev), with the object there,
          // is corrupt.
          const readFailure = error instanceof MediaToolError && !error.timedOut;
          const finalAttempt =
            ctx.attempt.number >= PROBE_ATTEMPTS || ctx.environment.type === "DEVELOPMENT";
          let second: unknown = error;
          if (readFailure && finalAttempt) {
            try {
              facts = await probeUrl(url);
              second = null;
            } catch (again) {
              second = again;
            }
          }
          if (second === null) {
            // The second read worked: use it.
          } else if (
            readFailure &&
            finalAttempt &&
            second instanceof MediaToolError &&
            !second.timedOut &&
            (await r2.headObject(found.originalKey))
          ) {
            facts = null;
          } else {
            throw error;
          }
        }

        if (facts) {
          try {
            const jpeg = await thumbnailFromUrl(url, facts, found.id);
            await r2.putObject(thumbnailKey(found.id), jpeg, "image/jpeg");
          } catch (error) {
            logger.warn("probe: thumbnail skipped", {
              takeId: found.id,
              reason: error instanceof Error ? error.name : "unknown",
            });
          }
        }

        const marked = await markUploaded(db, {
          takeId: found.id,
          sizeBytes: found.originalBytes,
          probe: facts,
        });
        if (!marked.ok) {
          // Deleted meanwhile: don't leave the thumbnail we just wrote behind.
          if (marked.error === "not_found") {
            // If the delete fails too, queue the key so the drain retries it: never orphaned.
            await r2
              .deleteObject(thumbnailKey(found.id))
              .catch(() => queueDeletions(db, [thumbnailKey(found.id)]));
          }
          return { takeId: found.id, outcome: marked.error };
        }
        if (marked.data.status === "failed") {
          if (marked.data.failureCode) {
            await recordTakeFailed(db, found, marked.data.failureCode);
          }
          return {
            takeId: found.id,
            outcome: "rejected" as const,
            failureCode: marked.data.failureCode,
          };
        }
      }

      return startAndDispatch(db, found.id, found.creatorId, usageSecret);
    });
  },
  onFailure: async ({ payload }) => {
    const env = parseJobEnv();
    await withJobDb(env.DATABASE_URL, async (db) => {
      // An older run that failed after cleanup dispatched a newer one (a higher `redispatch`)
      // must not fail a take the newer run is still probing: only the newest owner may.
      const [current] = await db
        .select({ attempts: take.probeAttempts })
        .from(take)
        .where(eq(take.id, payload.takeId));
      if (current && !ownsTakeAfterFailure(payload.redispatch, current.attempts)) {
        logger.info("probe: a newer dispatch owns the take, not failing it", {
          takeId: payload.takeId,
        });
        return;
      }
      // Never probed: fail the upload.
      const fromUploading = await transitionTake(db, payload.takeId, "uploading", "failed", {
        failureCode: "internal_error",
        uploadId: null,
      });
      if (fromUploading.ok) {
        await recordFailedById(db, payload.takeId, "internal_error");
        return;
      }
      // Probed but no job ever started (start or dispatch kept failing): fail it with a
      // refundable code so the creator gets "Try again". A take that has a job keeps it.
      const [job] = await db
        .select({ id: processingJob.id })
        .from(processingJob)
        .where(eq(processingJob.takeId, payload.takeId))
        .limit(1);
      if (!job) {
        const moved = await transitionTake(db, payload.takeId, "uploaded", "failed", {
          failureCode: "internal_error",
        });
        if (moved.ok) await recordFailedById(db, payload.takeId, "internal_error");
      }
    });
  },
});

/**
 * Starts processing for an uploaded take and dispatches it. If the take already has an active
 * job that was never dispatched (a rerun after a crash), dispatches that one instead.
 */
export async function startAndDispatch(
  db: Db,
  takeId: string,
  creatorId: string,
  usageSecret: string,
) {
  const trigger = triggerForJob("process-take");
  // The probe only ever starts the first job of a freshly uploaded take; re runs and
  // retries are the creator's call. Checked again inside startJob's lock.
  const started = await startJob(db, {
    creatorId,
    takeId,
    usageSecret,
    fromStatuses: ["uploaded"],
  });
  if (started.ok) {
    const dispatched = await dispatchJob(db, { jobId: started.data.id, trigger });
    // No run started and the job is already failed (`trigger_failed`): the creator isn't
    // waiting on a response here, so the email is how they learn it.
    if (!dispatched.ok) await queueTakeEmail(started.data.id, started.data.kind);
    return {
      takeId,
      outcome: "started" as const,
      jobId: started.data.id,
      dispatched: dispatched.ok,
    };
  }
  if (started.error === "job_in_progress") {
    const [active] = await db
      .select()
      .from(processingJob)
      .where(
        and(eq(processingJob.takeId, takeId), inArray(processingJob.status, ACTIVE_JOB_STATUSES)),
      );
    if (active && !active.triggerRunId) {
      const dispatched = await dispatchJob(db, { jobId: active.id, trigger });
      if (!dispatched.ok) await queueTakeEmail(active.id, active.kind);
      return {
        takeId,
        outcome: "redispatched" as const,
        jobId: active.id,
        dispatched: dispatched.ok,
      };
    }
    return { takeId, outcome: "already_processing" as const };
  }
  if (started.error === "limit_exceeded") {
    // Spec 0014 AC-6: the first charge does not fit. No job, nothing charged; the take is
    // kept (original and expiry untouched) and the creator can retry after the reset. An
    // expected result: logged with IDs only, never sent to the error tracker.
    const failed = await transitionTake(db, takeId, "uploaded", "failed", {
      failureCode: "limit_exceeded",
    });
    logger.info("probe: allowance used up, take kept", { takeId, moved: failed.ok });
    if (failed.ok) {
      await recordTakeFailed(db, { id: takeId, creatorId }, "limit_exceeded");
      await recordJobEvent(db, {
        name: "limit_hit",
        creatorId,
        takeId,
        props: { place: "upload_complete" },
      });
    }
    return { takeId, outcome: "limit_exceeded" as const };
  }
  return { takeId, outcome: "not_started" as const, reason: started.error };
}

/** Records `take_failed` for a take known only by ID (the creator is read here). Never throws. */
async function recordFailedById(db: Db, takeId: string, code: string): Promise<void> {
  try {
    const [row] = await db
      .select({ id: take.id, creatorId: take.creatorId })
      .from(take)
      .where(eq(take.id, takeId));
    if (row) await recordTakeFailed(db, row, code);
  } catch {
    logger.error("analytics event failed", { name: "take_failed", takeId });
  }
}
