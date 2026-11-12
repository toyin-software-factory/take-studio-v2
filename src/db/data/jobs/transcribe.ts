import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ACTIVE_JOB_STATUSES, stepsFor } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { isExpired } from "@/lib/take-media";
import { processingJob, take, transcript } from "../../schema";
import type { Executor, ProcessingJob, Tx } from "../../types";
import { runStart, startJobRow } from "./start-shared";
import type { FinishError, FinishResult, StartedJob } from "./types";

export type TranscribeStartError =
  "not_found" | "invalid_transition" | "original_gone" | "already_done" | "job_active";

/**
 * `startTranscribeJob` (spec 0007, "Job model seam"), one transaction. Unlike `startJob` it
 * never moves the take and never charges:
 * 1. lock the take (`FOR UPDATE`);
 * 2. require it `ready` with the original still stored (`video_expires_at` null or in the
 *    future); an expired take or a passed expiry is `original_gone`, any other status is
 *    `invalid_transition`;
 * 3. refuse `already_done` when its transcript exists, and `job_active` while any job of the
 *    take is queued or running;
 * 4. insert the `transcribe` job (0 seconds, no charged month or hash) and its `transcript` step.
 * The creator scoped wrapper (ownership, Origin) lives in src/server.
 */
export async function startTranscribeJob(
  db: Executor,
  input: { readonly takeId: string; readonly now?: Date },
): Promise<Result<StartedJob, TranscribeStartError>> {
  if (!z.uuid().safeParse(input.takeId).success) return err("not_found");
  const now = input.now ?? new Date();

  return runStart<StartedJob, TranscribeStartError>(db, "job_active", async (tx) => {
    const [current] = await tx.select().from(take).where(eq(take.id, input.takeId)).for("update");
    if (!current) return err("not_found");

    if (isExpired(current, now)) return err("original_gone");
    if (current.status !== "ready") return err("invalid_transition");

    const [done] = await tx
      .select({ id: transcript.id })
      .from(transcript)
      .where(eq(transcript.takeId, current.id));
    if (done) return err("already_done");

    const [active] = await tx
      .select({ id: processingJob.id })
      .from(processingJob)
      .where(
        and(
          eq(processingJob.takeId, current.id),
          inArray(processingJob.status, ACTIVE_JOB_STATUSES),
        ),
      );
    if (active) return err("job_active");

    const started = await startJobRow(tx, {
      job: {
        takeId: current.id,
        kind: "transcribe",
        secondsCharged: 0,
        chargedMonth: null,
        chargedAccountHash: null,
      },
      stepNames: stepsFor("transcribe"),
    });
    return started ? ok(started) : err("job_active");
  });
}

/**
 * The finish of a `transcribe` job (spec 0007): it works beside the take, so the job status and
 * code are all that change. No take transition, no render flip or discard, no refund (it
 * charged nothing).
 */
export async function finishTranscribeJob(
  tx: Tx,
  job: ProcessingJob,
): Promise<Result<FinishResult, FinishError>> {
  const [current] = await tx.select().from(take).where(eq(take.id, job.takeId));
  if (!current) return err("not_found");
  return ok({ job, take: current, refundedSeconds: 0, queuedKeys: [] });
}
