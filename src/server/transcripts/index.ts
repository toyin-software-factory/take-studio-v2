import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getTranscriptByTake } from "@/db/data/transcripts";
import { jobStep, processingJob, take } from "@/db/schema";
import type { Executor } from "@/db/types";
import { ACTIVE_JOB_STATUSES, isSkipReason, type SkipReason } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { type PlainParagraph, groupParagraphs } from "@/lib/transcript-rules";

/**
 * Creator scoped transcript read (spec 0007, API surface). `creatorId` comes from the session;
 * another creator's take is `not_found`. Slice 2 returns the stored (untrimmed) paragraphs;
 * the trimmed timeline arrives with the next task.
 */

export type TranscriptState = "none" | "making" | "ready" | "skipped" | "failed";

export type TranscriptView = {
  readonly state: TranscriptState;
  readonly reason?: SkipReason;
  readonly canMake: boolean;
  readonly paragraphs?: readonly PlainParagraph[];
};

/** `state` per spec 0007 "Value sourcing": row → ready, else the latest transcribe job. */
export async function getTranscriptView(
  db: Executor,
  creatorId: string,
  takeId: string,
  now: Date = new Date(),
): Promise<Result<TranscriptView, "not_found">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");
  const [found] = await db
    .select()
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  if (!found) return err("not_found");

  const [latest] = await db
    .select()
    .from(processingJob)
    .where(and(eq(processingJob.takeId, takeId), eq(processingJob.kind, "transcribe")))
    .orderBy(desc(processingJob.createdAt))
    .limit(1);
  const jobs = await db
    .select({ status: processingJob.status })
    .from(processingJob)
    .where(eq(processingJob.takeId, takeId));
  const anyActive = jobs.some((j) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status));
  const stored = found.videoExpiresAt === null || found.videoExpiresAt.getTime() > now.getTime();
  const mayStart = found.status === "ready" && stored && !anyActive;

  const row = await getTranscriptByTake(db, takeId);
  if (row) {
    return ok({ state: "ready", canMake: false, paragraphs: groupParagraphs(row.words) });
  }
  if (!latest) return ok({ state: "none", canMake: mayStart });
  if ((ACTIVE_JOB_STATUSES as readonly string[]).includes(latest.status)) {
    return ok({ state: "making", canMake: false });
  }
  if (latest.status === "succeeded") {
    const [step] = await db
      .select({ failureCode: jobStep.failureCode, status: jobStep.status })
      .from(jobStep)
      .where(and(eq(jobStep.jobId, latest.id), eq(jobStep.name, "transcript")));
    const reason = step?.failureCode && isSkipReason(step.failureCode) ? step.failureCode : null;
    if (step?.status === "skipped" && reason)
      return ok({ state: "skipped", reason, canMake: false });
    // Succeeded without a row (take deleted mid job, or the row was removed): start over.
    return ok({ state: "none", canMake: mayStart });
  }
  return ok({ state: "failed", canMake: mayStart });
}
