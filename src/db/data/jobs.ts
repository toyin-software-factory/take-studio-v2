import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { refundSeconds } from "@/lib/billing";
import { type FailureCode, isFailureCode } from "@/lib/failure-codes";
import {
  ACTIVE_JOB_STATUSES,
  STEP_NAMES,
  STEP_STATUSES,
  type StepName,
  type StepStatus,
} from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { jobStep, processingJob, render, storageDeletion } from "../schema";
import { runTx } from "../tx";
import type { Executor, JobStep, ProcessingJob, Take, Tx } from "../types";
import { transitionTake } from "./takes";

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

const stepUpdateSchema = z.object({
  jobId: z.uuid(),
  name: z.enum(STEP_NAMES as [StepName, ...StepName[]]),
  status: z.enum(STEP_STATUSES),
  progress: z.number().int().min(0).max(100),
  failureCode: z.string().refine(isFailureCode).nullable().optional(),
});

const FINAL_STEP_STATUSES: readonly StepStatus[] = ["succeeded", "failed", "skipped"];

/**
 * `jobs.updateStep` (AC-7): sets a step's status and progress (0 to 100). Stamps
 * `started_at` the first time it runs and `finished_at` when it ends. Rejects bad input,
 * unknown steps and steps of a job that already finished with `invalid`.
 */
export async function updateStep(
  db: Executor,
  input: {
    readonly jobId: string;
    readonly name: StepName;
    readonly status: StepStatus;
    readonly progress: number;
    readonly failureCode?: FailureCode | null;
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

/**
 * Makes this job's newest succeeded render the take's latest (AC-10): the previous latest
 * loses `is_latest` and its `video_key`, and that key is queued for deletion in the same
 * transaction. Returns the queued keys. A no op when the job has no succeeded render or it
 * is already the latest. Shared with the renders data functions.
 */
export async function flipLatestRender(
  tx: Tx,
  input: { readonly takeId: string; readonly jobId: string },
): Promise<readonly string[]> {
  const [next] = await tx
    .select()
    .from(render)
    .where(
      and(
        eq(render.takeId, input.takeId),
        eq(render.jobId, input.jobId),
        eq(render.status, "succeeded"),
      ),
    )
    .orderBy(desc(render.createdAt))
    .limit(1)
    .for("update");
  if (!next || next.isLatest) return [];

  // Read and lock the old latest, then unset it before setting the new one: the partial
  // unique index allows one latest per take.
  const [previous] = await tx
    .select({ id: render.id, videoKey: render.videoKey })
    .from(render)
    .where(and(eq(render.takeId, input.takeId), eq(render.isLatest, true)))
    .for("update");
  const oldKeys = previous?.videoKey ? [previous.videoKey] : [];
  if (previous) {
    await tx
      .update(render)
      .set({ isLatest: false, videoKey: null })
      .where(eq(render.id, previous.id));
  }
  await queueDeletions(tx, oldKeys);

  await tx.update(render).set({ isLatest: true }).where(eq(render.id, next.id));
  return oldKeys;
}

export type FinishStatus = "succeeded" | "failed" | "cancelled";

export type FinishResult = {
  readonly job: ProcessingJob;
  readonly take: Take;
  /** Seconds given back by this call (0 when nothing was refunded). */
  readonly refundedSeconds: number;
  /** File keys queued for deletion in this transaction. */
  readonly queuedKeys: readonly string[];
};

export type FinishError = "not_found" | "already_final" | "invalid" | "invalid_transition";

type FinishInput = {
  readonly jobId: string;
  readonly status: FinishStatus;
  /** Required for `failed` and `cancelled`; must be null for `succeeded`. */
  readonly failureCode?: FailureCode | null;
  readonly now?: Date;
};

/**
 * `jobs.finish` (AC-11, AC-12, AC-13), one transaction:
 * 1. job compare and swap from `queued`/`running` to the final status (`already_final` on repeat);
 * 2. on success, this job's render becomes the latest (old key queued for deletion);
 * 3. take `processing` → `ready` on success, or on failure when a latest render exists,
 *    else → `failed` with the job's failure code;
 * 4. refund once (`refunded` compare and swap) when the failure code is refundable.
 */
export function finish(
  db: Executor,
  input: FinishInput,
): Promise<Result<FinishResult, FinishError>> {
  return runTx(db, (tx) => finishInTx(tx, input));
}

/** `finish` inside an open transaction (used by `jobs.cancel`). */
export async function finishInTx(
  tx: Tx,
  input: FinishInput,
): Promise<Result<FinishResult, FinishError>> {
  const failureCode = input.failureCode ?? null;
  const needsCode = input.status !== "succeeded";
  if (needsCode !== (failureCode !== null)) return err("invalid");
  if (failureCode !== null && !isFailureCode(failureCode)) return err("invalid");
  const now = input.now ?? new Date();

  // 1. Job compare and swap.
  const [job] = await tx
    .update(processingJob)
    .set({ status: input.status, failureCode, finishedAt: now })
    .where(
      and(eq(processingJob.id, input.jobId), inArray(processingJob.status, ACTIVE_JOB_STATUSES)),
    )
    .returning();
  if (!job) {
    const [exists] = await tx
      .select({ id: processingJob.id })
      .from(processingJob)
      .where(eq(processingJob.id, input.jobId));
    return err(exists ? "already_final" : "not_found");
  }

  // 2. Latest render flip on success.
  const queuedKeys =
    input.status === "succeeded"
      ? await flipLatestRender(tx, { takeId: job.takeId, jobId: job.id })
      : [];

  // 3. Take transition.
  const [latest] = await tx
    .select({ id: render.id })
    .from(render)
    .where(and(eq(render.takeId, job.takeId), eq(render.isLatest, true)));
  const toReady = input.status === "succeeded" || latest !== undefined;
  const moved = await transitionTake(
    tx,
    job.takeId,
    "processing",
    toReady ? "ready" : "failed",
    // A take that works again carries no old failure.
    { failureCode: toReady ? null : failureCode },
  );
  if (!moved.ok) return err(moved.error);

  // 4. Refund at most once.
  const owed = refundSeconds(job);
  let refundedSeconds = 0;
  let finalJob = job;
  if (owed > 0) {
    const [refunded] = await tx
      .update(processingJob)
      .set({ refunded: true })
      .where(and(eq(processingJob.id, job.id), eq(processingJob.refunded, false)))
      .returning();
    if (refunded) {
      refundedSeconds = owed;
      finalJob = refunded;
    }
  }

  return ok({ job: finalJob, take: moved.data, refundedSeconds, queuedKeys });
}

/** Inserts `keys` into the storage deletion queue (same transaction as the row change). */
export async function queueDeletions(tx: Executor, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await tx
    .insert(storageDeletion)
    .values(keys.map((objectKey) => ({ id: crypto.randomUUID(), objectKey })));
}
