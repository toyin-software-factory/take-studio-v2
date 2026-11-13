import { and, eq, inArray } from "drizzle-orm";
import { isFailureCode } from "@/lib/failure-codes";
import { ACTIVE_JOB_STATUSES, isBackgroundKind, isTranscribeKind } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { processingJob, take } from "../../schema";
import { runTx } from "../../tx";
import type { Executor, Tx } from "../../types";
import { finishBackgroundJob } from "./background";
import { finishVideoJob } from "./initial";
import { lockTakeForJob } from "./locks";
import { finishTranscribeJob } from "./transcribe";
import type { FinishError, FinishInput, FinishResult } from "./types";

/**
 * `jobs.finish` (AC-11, AC-12, AC-13), one transaction:
 * 1. job compare and swap from `queued`/`running` to the final status (`already_final` on repeat);
 * then by kind: a `transcribe` job does only step 1 (`finishTranscribeJob`), a background
 * change flips the latest render or discards its files and never moves the take or refunds
 * (`finishBackgroundJob`), and a video job (`initial`, `rerender`) flips or discards renders,
 * moves the take and refunds once (`finishVideoJob`).
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

  // 0. Lock order (src/db/AGENTS.md): creator, background, take, then the job.
  const owner = await lockTakeForJob(tx, input.jobId);
  if (!owner) return err("not_found");

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

  if (isTranscribeKind(job.kind)) return finishTranscribeJob(tx, job);

  const [current] = isBackgroundKind(job.kind)
    ? await tx.select().from(take).where(eq(take.id, job.takeId))
    : [];
  if (current) {
    return ok(await finishBackgroundJob(tx, { job, current, status: input.status }));
  }

  return finishVideoJob(tx, { job, status: input.status, failureCode });
}
