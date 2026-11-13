import { eq } from "drizzle-orm";
import { runTx } from "../tx";
import type { TranscriptEdit, TranscriptWord } from "@/lib/transcript-rules";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { processingJob, take, transcript } from "../schema";
import { finishInTx, updateStep } from "./jobs";
import { type Executor, type Transcript, pgErrorCode } from "../types";

/**
 * System functions for the transcript table (spec 0007). Personal data: act on IDs only, and
 * never log or return the text outside the caller that needs it.
 */

/** The take's transcript, or null when none was made yet. */
export async function getTranscriptByTake(
  db: Executor,
  takeId: string,
): Promise<Transcript | null> {
  const [row] = await db.select().from(transcript).where(eq(transcript.takeId, takeId));
  return row ?? null;
}

/**
 * Sets the take's AI fixes (spec 0012: `[]` on fallback), bumping `updated_at` so the caption
 * track version changes. No transcript row is a no op. Personal data: IDs only in logs.
 */
export async function setTranscriptEdits(
  db: Executor,
  takeId: string,
  edits: readonly TranscriptEdit[],
): Promise<void> {
  await db
    .update(transcript)
    .set({ edits, updatedAt: new Date() })
    .where(eq(transcript.takeId, takeId));
}

export type TranscriptInput = {
  readonly takeId: string;
  readonly language: string;
  /** The provider's full transcript, fillers included. */
  readonly text: string;
  readonly words: readonly TranscriptWord[];
  readonly sourceFps: number;
  readonly model: string;
};

/**
 * One transcript per take: inserts, or overwrites the existing row (a repeat run replaces it
 * and bumps `updated_at`). `take_gone` when the take was deleted meanwhile (the foreign key
 * refuses), so a task can end quietly.
 */
export async function upsertTranscript(
  db: Executor,
  input: TranscriptInput,
): Promise<Result<Transcript, "take_gone">> {
  const values = {
    language: input.language,
    text: input.text,
    words: input.words,
    sourceFps: input.sourceFps,
    model: input.model,
  };
  try {
    const [row] = await db
      .insert(transcript)
      .values({ id: crypto.randomUUID(), takeId: input.takeId, ...values })
      .onConflictDoUpdate({
        target: transcript.takeId,
        // A new transcript replaces the words, so any earlier fixes no longer apply.
        set: { ...values, edits: [], updatedAt: new Date() },
      })
      .returning();
    return row ? ok(row) : err("take_gone");
  } catch (error) {
    if (pgErrorCode(error).code === "23503") return err("take_gone");
    throw error;
  }
}

/**
 * Saves a transcript and finishes its `transcribe` job in one transaction (spec 0007). The job
 * row is locked and must still be queued or running, so a run that cleanup already failed (or
 * that was cancelled) can never publish a transcript: `job_final`, nothing written. A take
 * deleted meanwhile finishes the job without a transcript (`saved: false`).
 */
export async function saveTranscriptAndFinish(
  db: Executor,
  jobId: string,
  input: TranscriptInput,
): Promise<Result<{ readonly saved: boolean }, "job_final" | "failed">> {
  return runTx(db, async (tx) => {
    // Lock order is take, then job, like take deletion (which locks the take, then deletes its
    // jobs), so the two never wait on each other.
    const [owner] = await tx
      .select({ takeId: processingJob.takeId })
      .from(processingJob)
      .where(eq(processingJob.id, jobId));
    if (!owner) return err("job_final");
    const [lockedTake] = await tx
      .select({ id: take.id })
      .from(take)
      .where(eq(take.id, owner.takeId))
      .for("update");
    // Deleted meanwhile: the job went with it, so there is nothing to finish.
    if (!lockedTake) return ok({ saved: false });
    const [job] = await tx
      .select({ status: processingJob.status })
      .from(processingJob)
      .where(eq(processingJob.id, jobId))
      .for("update");
    if (!job || !(ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status)) {
      return err("job_final");
    }
    // A savepoint: a foreign key error must not poison the outer transaction.
    const saved = await runTx(tx, (inner) => upsertTranscript(inner, input));
    if (saved.ok) {
      await updateStep(tx, { jobId, name: "transcript", status: "succeeded", progress: 100 });
    }
    const finished = await finishInTx(tx, { jobId, status: "succeeded" });
    if (!finished.ok) return err("failed");
    return ok({ saved: saved.ok });
  });
}
