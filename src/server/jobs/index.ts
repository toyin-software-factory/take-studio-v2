import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type StartError,
  type StartedJob,
  startJob,
  type FinishError,
  type FinishResult,
  finish,
  finishInTx,
  markRunning,
  updateStep,
} from "@/db/data/jobs";
import { processingJob, take } from "@/db/schema";
import { runTx } from "@/db/tx";
import type { Executor } from "@/db/types";
import { type Result, err } from "@/lib/result";

/**
 * Creator scoped job functions (spec 0002, API surface; AC-2, AC-6, AC-13). `creatorId`
 * comes from the session. System functions are re exported so callers see one `jobs`
 * surface; Trigger.dev tasks import them from src/db/data/jobs instead.
 */
export { finish, markRunning, updateStep };

export type { StartError, StartedJob };

/**
 * `jobs.start` (AC-6): the creator starts processing their take. The logic lives in
 * `startJob` (src/db/data/jobs.ts), so the probe task can start jobs too.
 */
export function start(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly usageSecret: string;
    readonly now?: Date;
  },
): Promise<Result<StartedJob, StartError>> {
  return startJob(db, input);
}

/**
 * `jobs.cancel` (AC-13): the creator cancels their job. A `queued` job is cancelled with
 * `cancelled_before_start` (refunded); a `running` one with `cancelled_while_running` (not
 * refunded). Runs `finish` in the same transaction as the ownership check and row lock.
 * The caller cancels the Trigger.dev run (`job.triggerRunId`) after this succeeds.
 */
export function cancel(
  db: Executor,
  input: { readonly creatorId: string; readonly jobId: string; readonly now?: Date },
): Promise<Result<FinishResult, Exclude<FinishError, "invalid">>> {
  if (!z.uuid().safeParse(input.jobId).success) return Promise.resolve(err("not_found"));

  return runTx(db, async (tx) => {
    const [row] = await tx
      .select({ status: processingJob.status })
      .from(processingJob)
      .innerJoin(take, eq(take.id, processingJob.takeId))
      .where(and(eq(processingJob.id, input.jobId), eq(take.creatorId, input.creatorId)))
      .for("update", { of: processingJob });
    if (!row) return err("not_found");
    if (row.status !== "queued" && row.status !== "running") return err("already_final");

    const finished = await finishInTx(tx, {
      jobId: input.jobId,
      status: "cancelled",
      failureCode: row.status === "queued" ? "cancelled_before_start" : "cancelled_while_running",
      now: input.now,
    });
    // `invalid` can't happen: the status and code above are always a valid pair.
    if (!finished.ok) return err(finished.error === "invalid" ? "not_found" : finished.error);
    return finished;
  });
}
