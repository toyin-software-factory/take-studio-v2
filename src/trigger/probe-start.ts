import { logger } from "@trigger.dev/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { dispatchJob } from "@/db/data/dispatch";
import { startJob } from "@/db/data/jobs";
import { transitionTake } from "@/db/data/takes";
import { processingJob, take } from "@/db/schema";
import type { Db } from "@/db/types";
import { triggerForJob } from "@/lib/trigger-runs";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { recordJobEvent, recordTakeFailed } from "./analytics/record";
import { queueTakeEmail } from "./email/queue";

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
    if (!dispatched.ok) {
      if (dispatched.error === "trigger_failed")
        await recordFailedById(db, takeId, "trigger_failed");
      await queueTakeEmail(started.data.id, started.data.kind);
    }
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
      if (!dispatched.ok) {
        if (dispatched.error === "trigger_failed") {
          await recordFailedById(db, takeId, "trigger_failed");
        }
        await queueTakeEmail(active.id, active.kind);
      }
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
export async function recordFailedById(db: Db, takeId: string, code: string): Promise<void> {
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
