import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { chargeSeconds, chargedMonth, refundSeconds } from "@/lib/billing";
import { type FailureCode, isMediaFailure } from "@/lib/failure-codes";
import { type JobKind, type TakeStatus, stepsFor } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { usageAccountHash } from "@/lib/usage-hash";
import { isVideoExpired } from "@/lib/video-expiry";
import { processingJob, render, take, user } from "../../schema";
import type { Executor, ProcessingJob, Tx } from "../../types";
import { transitionTake } from "../takes";
import { lockBackgroundShare } from "./locks";
import { discardJobRenders, flipLatestRender } from "./render-files";
import { runStart, startJobRow } from "./start-shared";
import type { FinishResult, FinishError, FinishStatus, StartedJob } from "./types";

export type StartError = "not_found" | "job_in_progress" | "invalid_transition";

/**
 * Whether a take may start a job: `uploaded` or `ready`, or `failed` when the failure was not
 * the media's fault (AC-10: media failures need a new upload, other failures can be retried).
 * Either way the take must have been probed (it has a length).
 */
function canStart(t: {
  readonly status: string;
  readonly durationMs: number | null;
  readonly failureCode: string | null;
}): boolean {
  if (t.durationMs === null) return false;
  if (t.status === "uploaded" || t.status === "ready") return true;
  return t.status === "failed" && !isMediaFailure(t.failureCode);
}

/**
 * `startJob` (`jobs.start`, AC-6), one transaction, so nothing is charged if any part fails:
 * 1. lock the creator's take (`FOR UPDATE`, so concurrent starts queue up);
 * 2. derive the kind: `initial` unless the take already has a succeeded initial job;
 * 3. charge `ceil(duration_ms / 1000)` seconds for an initial run unless an earlier initial
 *    run was charged and not refunded, else 0, recording the UTC month and account hash;
 * 4. create the job (`queued`) and its ordered live steps;
 * 5. move the take to `processing` (compare and swap).
 * The usage limit check (`limit_exceeded`) arrives in slice 6; the charge is recorded now.
 * `usageSecret` is USAGE_HASH_SECRET from `parseUsageEnv()`.
 */
export async function startJob(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly usageSecret: string;
    readonly now?: Date;
    /** Take statuses this caller may start from (checked under the lock); default: any startable. */
    readonly fromStatuses?: readonly TakeStatus[];
  },
): Promise<Result<StartedJob, StartError>> {
  if (!z.uuid().safeParse(input.takeId).success) return err("not_found");
  const now = input.now ?? new Date();

  // Lock order (src/db/AGENTS.md): creator, background, take, job. The take's current
  // background is read first so it can be locked (key share) before the take.
  const [peek] = await db
    .select({ backgroundId: take.backgroundId })
    .from(take)
    .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)));

  return runStart<StartedJob, StartError>(db, "job_in_progress", async (tx) => {
    if (peek?.backgroundId) await lockBackgroundShare(tx, peek.backgroundId);
    const [locked] = await tx
      .select({ take, email: user.email })
      .from(take)
      .innerJoin(user, eq(user.id, take.creatorId))
      .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)))
      .for("update", { of: take });
    if (!locked) return err("not_found");
    const current = locked.take;

    if (current.status === "processing") return err("job_in_progress");
    if (current.durationMs === null || !canStart(current)) return err("invalid_transition");
    if (input.fromStatuses && !input.fromStatuses.includes(current.status)) {
      return err("invalid_transition");
    }
    // A failed take whose video has expired has nothing left to process (matches the
    // page's and the retry route's retryable check).
    if (current.status === "failed" && isVideoExpired(current.videoExpiresAt, now)) {
      return err("invalid_transition");
    }

    const priorInitial = await tx
      .select({
        status: processingJob.status,
        secondsCharged: processingJob.secondsCharged,
        refunded: processingJob.refunded,
      })
      .from(processingJob)
      .where(and(eq(processingJob.takeId, current.id), eq(processingJob.kind, "initial")));

    const kind: JobKind = priorInitial.some((job) => job.status === "succeeded")
      ? "rerender"
      : "initial";
    const alreadyPaid = priorInitial.some((job) => job.secondsCharged > 0 && !job.refunded);
    const secondsCharged =
      kind === "initial" && !alreadyPaid ? chargeSeconds(current.durationMs) : 0;
    const charged = secondsCharged > 0;

    const started = await startJobRow(tx, {
      job: {
        takeId: current.id,
        kind,
        // Spec 0008: the background this job renders onto (null is the original).
        targetBackgroundId: current.backgroundId,
        secondsCharged,
        chargedMonth: charged ? chargedMonth(now) : null,
        chargedAccountHash: charged
          ? await usageAccountHash(locked.email, input.usageSecret)
          : null,
      },
      stepNames: stepsFor(kind, { hasBackground: current.backgroundId !== null }),
    });
    if (!started) return err("job_in_progress");

    // A retry clears the previous failure code.
    const moved = await transitionTake(tx, current.id, current.status, "processing", {
      failureCode: null,
    });
    if (!moved.ok) return err(moved.error);

    return ok(started);
  });
}

/**
 * The finish of an `initial` or `rerender` job (the video path), inside `finishInTx` after the
 * job compare and swap:
 * 2. on success this job's render becomes the latest; otherwise its renders' files go;
 * 3. take `processing` → `ready` on success, or on failure when a latest render exists, else
 *    → `failed` with the job's failure code;
 * 4. refund once (`refunded` compare and swap) when the failure code is refundable.
 */
export async function finishVideoJob(
  tx: Tx,
  input: {
    readonly job: ProcessingJob;
    readonly status: FinishStatus;
    readonly failureCode: FailureCode | null;
  },
): Promise<Result<FinishResult, FinishError>> {
  const { job, failureCode } = input;

  // 2. On success this job's render becomes the latest; otherwise its renders' files go.
  const queuedKeys =
    input.status === "succeeded"
      ? await flipLatestRender(tx, { takeId: job.takeId, jobId: job.id })
      : await discardJobRenders(tx, { takeId: job.takeId, jobId: job.id });

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
