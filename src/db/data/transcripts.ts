import { eq } from "drizzle-orm";
import type { TranscriptWord } from "@/lib/transcript-rules";
import { type Result, err, ok } from "@/lib/result";
import { transcript } from "../schema";
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
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return row ? ok(row) : err("take_gone");
  } catch (error) {
    if (pgErrorCode(error).code === "23503") return err("take_gone");
    throw error;
  }
}
