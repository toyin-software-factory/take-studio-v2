import { eq } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { type Result, err } from "@/lib/result";
import { background, processingJob, take } from "../../schema";
import { runTx } from "../../tx";
import type { Executor, Tx } from "../../types";

/**
 * Lock helpers for jobs. Lock order (src/db/AGENTS.md): creator, background, take, job. Never
 * lock a job and then wait for its take: it deadlocks against deletion.
 */

/** Locks a background `FOR KEY SHARE`, so a background delete cannot cross a write onto it. */
export async function lockBackgroundShare(tx: Tx, backgroundId: string): Promise<void> {
  await tx
    .select({ id: background.id })
    .from(background)
    .where(eq(background.id, backgroundId))
    .for("key share");
}

/**
 * Reads the job's take and target background, then locks them in order: the background
 * `FOR KEY SHARE` (when the job renders onto one), then the take `FOR UPDATE`. A path that may
 * write `take.background_id` takes the background first, so a background delete (which locks it
 * `FOR UPDATE` and then updates the jobs and takes that point at it) cannot cross it. Deletion
 * and the transcript save already start from the take, so finishing must too, or two of them
 * can deadlock. Returns undefined when the job does not exist.
 */
export async function lockTakeForJob(
  tx: Tx,
  jobId: string,
): Promise<{ readonly takeId: string; readonly backgroundId: string | null } | undefined> {
  const [owner] = await tx
    .select({ takeId: processingJob.takeId, backgroundId: processingJob.targetBackgroundId })
    .from(processingJob)
    .where(eq(processingJob.id, jobId));
  if (!owner) return undefined;
  if (owner.backgroundId) await lockBackgroundShare(tx, owner.backgroundId);
  await tx.select({ id: take.id }).from(take).where(eq(take.id, owner.takeId)).for("update");
  return owner;
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
    // A job that renders onto a background holds it (key share) first, so a background delete
    // waits for the write instead of crossing it.
    const owner = await lockTakeForJob(tx, jobId);
    if (!owner) return err("job_final");
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
