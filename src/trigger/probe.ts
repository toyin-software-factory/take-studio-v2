import { logger, task } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { withJobDb } from "@/db/client/job";
import { queueDeletions } from "@/db/data/jobs";
import { admitGuestTake } from "@/db/data/guest-admit";
import { markUploaded, transitionTake } from "@/db/data/takes";
import { processingJob, take } from "@/db/schema";
import { parseJobEnv, parseUsageEnv } from "@/lib/env";
import { PROBE_LIMITS, ownsTakeAfterFailure } from "@/lib/cleanup-rules";
import { createR2 } from "@/lib/r2";
import { thumbnailKey } from "@/lib/take-rules";
import { recordTakeFailed } from "./analytics/record";
import { MediaToolError, probeUrl, thumbnailFromUrl } from "./media";
import { recordFailedById, startAndDispatch } from "./probe-start";

export { startAndDispatch };

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

      // Spec 0023: a guest drop is length checked and reserved against the day's budget here,
      // before any job exists. A refusal has already failed the take and queued the original.
      const admission = await admitGuestTake(db, found.id);
      if (admission !== "admitted") {
        await recordTakeFailed(db, found, admission);
        return { takeId: found.id, outcome: "rejected" as const, failureCode: admission };
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
