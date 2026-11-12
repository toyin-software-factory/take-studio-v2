import { and, eq, inArray, isNull } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { processingJob, take } from "../schema";
import type { Executor } from "../types";
import { finish } from "./jobs";

/**
 * Hands a started job to Trigger.dev (spec 0002, "Background work"). `trigger` must use the
 * job ID as a global idempotency key, so a retried dispatch never starts a second run (see
 * `triggerForJob` in src/lib/trigger-runs.ts). On success the run ID is stored on the job;
 * if triggering throws, the job is finished at once with the refundable `trigger_failed`.
 */
export async function dispatchJob(
  db: Executor,
  input: {
    readonly jobId: string;
    /** `creatorId` lets the trigger give the run a per creator concurrency key. */
    readonly trigger: (jobId: string, creatorId?: string) => Promise<{ readonly id: string }>;
  },
): Promise<Result<{ readonly runId: string }, "trigger_failed" | "not_found">> {
  // The job's creator, for the run's concurrency key (an unknown job just has none).
  const [owner] = await db
    .select({ creatorId: take.creatorId })
    .from(processingJob)
    .innerJoin(take, eq(take.id, processingJob.takeId))
    .where(eq(processingJob.id, input.jobId));
  let runId: string;
  try {
    ({ id: runId } = await input.trigger(input.jobId, owner?.creatorId));
  } catch {
    const finished = await finish(db, {
      jobId: input.jobId,
      status: "failed",
      failureCode: "trigger_failed",
    });
    return err(finished.ok || finished.error === "already_final" ? "trigger_failed" : "not_found");
  }

  // Keep the first run ID; markRunning also records it.
  await db
    .update(processingJob)
    .set({ triggerRunId: runId })
    .where(
      and(
        eq(processingJob.id, input.jobId),
        isNull(processingJob.triggerRunId),
        inArray(processingJob.status, ACTIVE_JOB_STATUSES),
      ),
    );
  return ok({ runId });
}
