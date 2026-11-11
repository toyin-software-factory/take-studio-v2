import { logger, task } from "@trigger.dev/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { withJobDb } from "@/db/client/job";
import { dispatchJob } from "@/db/data/dispatch";
import { startJob } from "@/db/data/jobs";
import { markUploaded, transitionTake } from "@/db/data/takes";
import { processingJob, take } from "@/db/schema";
import type { Db } from "@/db/types";
import { parseJobEnv, parseUsageEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { thumbnailKey } from "@/lib/take-rules";
import { triggerForJob } from "@/lib/trigger-runs";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { MediaToolError, probeUrl, thumbnailFromUrl } from "./media";

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
export const probeTask = task({
  id: "probe",
  machine: "small-2x",
  maxDuration: 300,
  retry: { maxAttempts: 3 },
  run: async (payload: { readonly takeId: string }) => {
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
        let facts: Awaited<ReturnType<typeof probeUrl>>;
        try {
          facts = await probeUrl(url);
        } catch (error) {
          // ffprobe couldn't read it. If the object is there, the file is bad; else retry.
          if (error instanceof MediaToolError && (await r2.headObject(found.originalKey))) {
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
        if (!marked.ok) return { takeId: found.id, outcome: marked.error };
        if (marked.data.status === "failed") {
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
    await withJobDb(env.DATABASE_URL, (db) =>
      transitionTake(db, payload.takeId, "uploading", "failed", {
        failureCode: "internal_error",
        uploadId: null,
      }),
    );
  },
});

/**
 * Starts processing for an uploaded take and dispatches it. If the take already has an active
 * job that was never dispatched (a rerun after a crash), dispatches that one instead.
 */
async function startAndDispatch(db: Db, takeId: string, creatorId: string, usageSecret: string) {
  const trigger = triggerForJob("process-take");
  const started = await startJob(db, { creatorId, takeId, usageSecret });
  if (started.ok) {
    const dispatched = await dispatchJob(db, { jobId: started.data.id, trigger });
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
      return {
        takeId,
        outcome: "redispatched" as const,
        jobId: active.id,
        dispatched: dispatched.ok,
      };
    }
    return { takeId, outcome: "already_processing" as const };
  }
  return { takeId, outcome: started.error };
}
