import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type FailureCode, isFailureCode } from "@/lib/failure-codes";
import {
  ACTIVE_JOB_STATUSES,
  STEP_NAMES,
  STEP_STATUSES,
  type SkipReason,
  type StepName,
  type StepStatus,
  isSkipReason,
} from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { jobStep, processingJob } from "../../schema";
import type { Executor, JobStep, ProcessingJob } from "../../types";

/**
 * System functions for processing jobs (spec 0002, API surface), safe for jobs: they act on
 * IDs only. Creator scoped `jobs.start` and `jobs.cancel` live in src/server/jobs.
 */

/**
 * `jobs.markRunning`: `queued` → `running` with the Trigger.dev run ID. Repeating it on a
 * running job is a no op that returns the job; a final job returns `already_final`.
 */
export async function markRunning(
  db: Executor,
  input: { readonly jobId: string; readonly triggerRunId: string; readonly now?: Date },
): Promise<Result<ProcessingJob, "not_found" | "already_final">> {
  const [updated] = await db
    .update(processingJob)
    .set({
      status: "running",
      triggerRunId: input.triggerRunId,
      startedAt: input.now ?? new Date(),
    })
    .where(and(eq(processingJob.id, input.jobId), eq(processingJob.status, "queued")))
    .returning();
  if (updated) return ok(updated);

  const [current] = await db.select().from(processingJob).where(eq(processingJob.id, input.jobId));
  if (!current) return err("not_found");
  return current.status === "running" ? ok(current) : err("already_final");
}

const stepUpdateSchema = z
  .object({
    jobId: z.uuid(),
    name: z.enum(STEP_NAMES as [StepName, ...StepName[]]),
    status: z.enum(STEP_STATUSES),
    progress: z.number().int().min(0).max(100),
    failureCode: z.string().nullable().optional(),
  })
  // Spec 0007: a skipped step may carry a skip reason, a failed step a failure code, and no
  // other status carries either. A skip reason on a failed step (or the reverse) is rejected.
  .refine(({ status, failureCode }) => {
    if (failureCode === null || failureCode === undefined) return true;
    if (status === "skipped") return isSkipReason(failureCode);
    if (status === "failed") return isFailureCode(failureCode);
    return false;
  });

const FINAL_STEP_STATUSES: readonly StepStatus[] = ["succeeded", "failed", "skipped"];

/**
 * `jobs.updateStep` (AC-7): sets a step's status and progress (0 to 100). Stamps
 * `started_at` the first time it runs and `finished_at` when it ends. Rejects bad input,
 * unknown steps and steps of a job that already finished with `invalid`. `failureCode` is a
 * failure code only with `failed` and a skip reason only with `skipped` (spec 0007).
 */
export async function updateStep(
  db: Executor,
  input: {
    readonly jobId: string;
    readonly name: StepName;
    readonly status: StepStatus;
    readonly progress: number;
    readonly failureCode?: FailureCode | SkipReason | null;
    readonly now?: Date;
  },
): Promise<Result<JobStep, "invalid">> {
  const parsed = stepUpdateSchema.safeParse(input);
  if (!parsed.success) return err("invalid");
  const { jobId, name, status, progress, failureCode } = parsed.data;
  const now = input.now ?? new Date();

  const [updated] = await db
    .update(jobStep)
    .set({
      status,
      progress,
      failureCode: failureCode ?? null,
      startedAt:
        status === "pending"
          ? jobStep.startedAt
          : sql`coalesce(${jobStep.startedAt}, ${now.toISOString()}::timestamptz)`,
      finishedAt: FINAL_STEP_STATUSES.includes(status) ? now : null,
    })
    .where(
      and(
        eq(jobStep.jobId, jobId),
        eq(jobStep.name, name),
        // Only steps of a job that is still active.
        sql`exists (select 1 from ${processingJob} where ${processingJob.id} = ${jobStep.jobId} and ${inArray(processingJob.status, ACTIVE_JOB_STATUSES)})`,
      ),
    )
    .returning();
  return updated ? ok(updated) : err("invalid");
}
