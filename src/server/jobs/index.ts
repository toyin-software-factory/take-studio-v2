import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type FinishError,
  type FinishResult,
  finish,
  finishInTx,
  markRunning,
  updateStep,
} from "@/db/data/jobs";
import { transitionTake } from "@/db/data/takes";
import { jobStep, processingJob, take, user } from "@/db/schema";
import { runTx } from "@/db/tx";
import { type Executor, type JobStep, type ProcessingJob, pgErrorCode } from "@/db/types";
import { chargeSeconds, chargedMonth } from "@/lib/billing";
import { type JobKind, stepsFor } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { usageAccountHash } from "@/lib/usage-hash";

/**
 * Creator scoped job functions (spec 0002, API surface; AC-2, AC-6, AC-13). `creatorId`
 * comes from the session. System functions are re exported so callers see one `jobs`
 * surface; Trigger.dev tasks import them from src/db/data/jobs instead.
 */
export { finish, markRunning, updateStep };

export type StartedJob = ProcessingJob & { readonly steps: readonly JobStep[] };

export type StartError = "not_found" | "job_in_progress" | "invalid_transition";

/** Take statuses a job can start from, mapped to how the take gets to `processing`. */
const STARTABLE = new Set(["uploaded", "ready", "failed"] as const);

/**
 * `jobs.start` (AC-6), one transaction, so nothing is charged if any part fails:
 * 1. lock the creator's take (`FOR UPDATE`, so concurrent starts queue up);
 * 2. derive the kind: `initial` unless the take already has a succeeded initial job;
 * 3. charge `ceil(duration_ms / 1000)` seconds for an initial run unless an earlier initial
 *    run was charged and not refunded, else 0, recording the UTC month and account hash;
 * 4. create the job (`queued`) and its ordered live steps;
 * 5. move the take to `processing` (compare and swap).
 * The usage limit check (`limit_exceeded`) arrives in slice 6; the charge is recorded now.
 * `usageSecret` is USAGE_HASH_SECRET from `parseUsageEnv()`.
 */
export async function start(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly usageSecret: string;
    readonly now?: Date;
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
      // A failed take can retry only once it was probed (it has a length).
      if (
        !STARTABLE.has(current.status as "uploaded" | "ready" | "failed") ||
        current.durationMs === null
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
