import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chargeSeconds, chargedMonth, refundSeconds } from "@/lib/billing";
import { renderKey } from "@/lib/cut-rules";
import { type FailureCode, isFailureCode, isMediaFailure } from "@/lib/failure-codes";
import {
  ACTIVE_JOB_STATUSES,
  STEP_NAMES,
  STEP_STATUSES,
  type SkipReason,
  type StepName,
  type StepStatus,
  type JobKind,
  isSkipReason,
  isTranscribeKind,
  stepsFor,
  type TakeStatus,
} from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { usageAccountHash } from "@/lib/usage-hash";
import { jobStep, processingJob, render, storageDeletion, take, transcript, user } from "../schema";
import { runTx } from "../tx";
import {
  type Executor,
  type JobStep,
  type ProcessingJob,
  type Take,
  type Tx,
  pgErrorCode,
} from "../types";
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

/**
 * For a job that ended without success (AC-10): its renders never become the latest, so none
 * may keep a video file. Every non latest render of the job gets its `video_key` cleared and
 * its derived key (`renders/{takeId}/{renderId}.mp4`) queued for deletion, in the caller's
 * transaction. The derived key also covers a file uploaded before the render recorded
 * success; deleting a key that was never written is a no op. `pending` renders become
 * `failed`. Returns the queued keys.
 */
export async function discardJobRenders(
  tx: Tx,
  input: { readonly takeId: string; readonly jobId: string },
): Promise<readonly string[]> {
  const rows = await tx
    .select({ id: render.id, status: render.status })
    .from(render)
    .where(
      and(
        eq(render.takeId, input.takeId),
        eq(render.jobId, input.jobId),
        eq(render.isLatest, false),
      ),
    )
    .for("update");
  if (rows.length === 0) return [];

  const keys = rows.map((row) => renderKey(input.takeId, row.id));
  await queueDeletions(tx, keys);
  await tx
    .update(render)
    .set({
      videoKey: null,
      status: sql`case when ${render.status} = 'pending' then 'failed' else ${render.status} end`,
    })
    .where(
      inArray(
        render.id,
        rows.map((row) => row.id),
      ),
    );
  return keys;
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
 *    otherwise the job's renders lose their video files (keys queued for deletion);
 * 3. take `processing` → `ready` on success, or on failure when a latest render exists,
 *    else → `failed` with the job's failure code;
 * 4. refund once (`refunded` compare and swap) when the failure code is refundable.
 * A `transcribe` job only does step 1: it never moves the take, touches renders or refunds.
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

  // 0. Lock order (src/db/AGENTS.md): the take, then the job. Deletion and the transcript
  //    save already start from the take, so finishing must too, or two of them can deadlock.
  const [owner] = await tx
    .select({ takeId: processingJob.takeId })
    .from(processingJob)
    .where(eq(processingJob.id, input.jobId));
  if (!owner) return err("not_found");
  await tx.select({ id: take.id }).from(take).where(eq(take.id, owner.takeId)).for("update");

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

  // A transcribe job (spec 0007) works beside the take: the job status and code are all that
  // change. No take transition, no render flip or discard, no refund (it charged nothing).
  if (isTranscribeKind(job.kind)) {
    const [current] = await tx.select().from(take).where(eq(take.id, job.takeId));
    if (!current) return err("not_found");
    return ok({ job, take: current, refundedSeconds: 0, queuedKeys: [] });
  }

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

/** Inserts `keys` into the storage deletion queue (same transaction as the row change). */
export async function queueDeletions(tx: Executor, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await tx
    .insert(storageDeletion)
    .values(keys.map((objectKey) => ({ id: crypto.randomUUID(), objectKey })));
}

export type StartedJob = ProcessingJob & { readonly steps: readonly JobStep[] };

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

  try {
    return await runTx(db, async (tx) => {
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
      if (
        current.status === "failed" &&
        current.videoExpiresAt !== null &&
        current.videoExpiresAt.getTime() <= now.getTime()
      ) {
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

      const jobId = crypto.randomUUID();
      const [job] = await tx
        .insert(processingJob)
        .values({
          id: jobId,
          takeId: current.id,
          kind,
          status: "queued",
          secondsCharged,
          chargedMonth: charged ? chargedMonth(now) : null,
          chargedAccountHash: charged
            ? await usageAccountHash(locked.email, input.usageSecret)
            : null,
        })
        .returning();
      if (!job) return err("job_in_progress");

      const names = stepsFor(kind);
      const steps = await tx
        .insert(jobStep)
        .values(
          names.map((name, position) => ({
            id: crypto.randomUUID(),
            jobId,
            name,
            position,
            status: "pending",
            progress: 0,
          })),
        )
        .returning();

      // A retry clears the previous failure code.
      const moved = await transitionTake(tx, current.id, current.status, "processing", {
        failureCode: null,
      });
      if (!moved.ok) return err(moved.error);

      return ok({ ...job, steps: [...steps].sort((a, b) => a.position - b.position) });
    });
  } catch (error) {
    // Belt and braces for AC-4: the partial unique index refuses a second active job.
    const { code, constraint } = pgErrorCode(error);
    if (code === "23505" && constraint === "processing_job_one_active_per_take_uidx") {
      return err("job_in_progress");
    }
    throw error;
  }
}

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

  try {
    return await runTx(db, async (tx) => {
      const [current] = await tx.select().from(take).where(eq(take.id, input.takeId)).for("update");
      if (!current) return err("not_found");

      const expired =
        current.status === "expired" ||
        (current.videoExpiresAt !== null && current.videoExpiresAt.getTime() <= now.getTime());
      if (expired) return err("original_gone");
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

      const jobId = crypto.randomUUID();
      const [job] = await tx
        .insert(processingJob)
        .values({
          id: jobId,
          takeId: current.id,
          kind: "transcribe",
          status: "queued",
          secondsCharged: 0,
          chargedMonth: null,
          chargedAccountHash: null,
        })
        .returning();
      if (!job) return err("job_active");

      const steps = await tx
        .insert(jobStep)
        .values(
          stepsFor("transcribe").map((name, position) => ({
            id: crypto.randomUUID(),
            jobId,
            name,
            position,
            status: "pending",
            progress: 0,
          })),
        )
        .returning();

      return ok({ ...job, steps: [...steps].sort((a, b) => a.position - b.position) });
    });
  } catch (error) {
    // The partial unique index is the last guard against two active jobs on one take.
    const { code, constraint } = pgErrorCode(error);
    if (code === "23505" && constraint === "processing_job_one_active_per_take_uidx") {
      return err("job_active");
    }
    throw error;
  }
}

/**
 * Runs `fn` in one transaction only while the job is still queued or running (S2T-T07). Lock
 * order is the take, then the job (the rule in src/db/AGENTS.md, the same as `finishInTx`,
 * deletion and the transcript save), so a guarded write, a finish and a deletion never wait on
 * each other crosswise. The status is checked under the job lock, so an attempt whose job was
 * already finished writes nothing: `job_final`, and the transaction rolls back. With `signal`,
 * a deadline that fired while `fn` ran also rolls the writes back (`aborted`), before the
 * commit. Used for the writes an attempt makes beyond its own job rows (cuts, renders);
 * `saveTranscriptAndFinish` does the same for the transcript.
 */
export async function whileJobActive<T, E extends string>(
  db: Executor,
  jobId: string,
  fn: (tx: Tx) => Promise<Result<T, E>>,
  signal?: AbortSignal,
): Promise<Result<T, E | "job_final" | "aborted">> {
  return runTx<T, E | "job_final" | "aborted">(db, async (tx) => {
    const [owner] = await tx
      .select({ takeId: processingJob.takeId })
      .from(processingJob)
      .where(eq(processingJob.id, jobId));
    if (!owner) return err("job_final");
    await tx.select({ id: take.id }).from(take).where(eq(take.id, owner.takeId)).for("update");
    const [job] = await tx
      .select({ status: processingJob.status })
      .from(processingJob)
      .where(eq(processingJob.id, jobId))
      .for("update");
    if (!job || !(ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status)) {
      return err("job_final");
    }
    if (signal?.aborted) return err("aborted");
    const result = await fn(tx);
    // The deadline fired during the write: undo it rather than commit after the deadline.
    if (signal?.aborted) return err("aborted");
    return result;
  });
}
