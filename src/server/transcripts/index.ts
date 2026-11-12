import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchJob } from "@/db/data/dispatch";
import { startTranscribeJob } from "@/db/data/jobs";
import { getTranscriptByTake } from "@/db/data/transcripts";
import { jobStep, processingJob, take as takeTable } from "@/db/schema";
import type { Executor } from "@/db/types";
import { ACTIVE_JOB_STATUSES, isSkipReason, type SkipReason } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { type TrimmedParagraph, toTrimmedTranscript } from "@/lib/transcript-timeline";
import { isVideoExpired } from "@/lib/video-expiry";
import { getForCreator } from "../takes";

/**
 * The transcript of one of the creator's takes on the trimmed timeline (spec 0007, AC-2, AC-4,
 * AC-10). Ownership is in the query, so another creator's take is `not_found`, the same as a
 * take with no transcript. Works on an expired take: the transcript outlives the video. The
 * words are personal data: callers return them to the owner and never log them.
 */

export type TrimmedTranscriptView = {
  readonly title: string;
  readonly paragraphs: readonly TrimmedParagraph[];
  /** Changes when the transcript or the latest render does (the track URL's `?v=`). */
  readonly version: string;
};

export async function getTrimmedForCreator(
  db: Executor,
  creatorId: string,
  takeId: string,
): Promise<Result<TrimmedTranscriptView, "not_found">> {
  const found = await getForCreator(db, creatorId, takeId);
  if (!found.ok) return err("not_found");
  const { take, latestRender } = found.data;
  const stored = await getTranscriptByTake(db, take.id);
  if (!stored) return err("not_found");

  const paragraphs = toTrimmedTranscript(stored.words, {
    // No latest render (a take handed back uncut) means nothing was removed.
    removedRanges: latestRender?.removedRanges ?? [],
    durationMs: take.durationMs ?? 0,
    sourceFps: stored.sourceFps,
  });
  return ok({
    title: take.title,
    paragraphs,
    version: `${stored.updatedAt.getTime()}.${latestRender?.id ?? "none"}`,
  });
}

export type TranscriptState = "none" | "making" | "ready" | "skipped" | "failed";

export type TranscriptView = {
  readonly state: TranscriptState;
  readonly reason?: SkipReason;
  readonly canMake: boolean;
  /** Trimmed paragraphs and the track URL version (ready only). */
  readonly paragraphs?: readonly TrimmedParagraph[];
  readonly version?: string;
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
    .from(takeTable)
    .where(and(eq(takeTable.id, takeId), eq(takeTable.creatorId, creatorId)));
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
  const stored = !isVideoExpired(found.videoExpiresAt, now);
  const mayStart = found.status === "ready" && stored && !anyActive;

  const row = await getTranscriptByTake(db, takeId);
  if (row) {
    const trimmed = await getTrimmedForCreator(db, creatorId, takeId);
    if (!trimmed.ok) return err("not_found");
    return ok({
      state: "ready",
      canMake: false,
      paragraphs: trimmed.data.paragraphs,
      version: trimmed.data.version,
    });
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

export type MakeError =
  "not_found" | "job_active" | "original_gone" | "already_done" | "not_ready" | "dispatch_failed";

/**
 * Make transcript / Try again (spec 0007, AC-9): the creator's own take only, then
 * `startTranscribeJob` (0 seconds charged, the take stays Ready) and the dispatch. A trigger
 * that throws finishes the job `trigger_failed` at once (inside `dispatchJob`), so it never
 * sits queued.
 */
export async function makeTranscript(
  db: Executor,
  creatorId: string,
  takeId: string,
  trigger: (jobId: string) => Promise<{ readonly id: string }>,
  now: Date = new Date(),
): Promise<Result<{ readonly jobId: string }, MakeError>> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");
  const [owned] = await db
    .select({ id: takeTable.id })
    .from(takeTable)
    .where(and(eq(takeTable.id, takeId), eq(takeTable.creatorId, creatorId)));
  if (!owned) return err("not_found");

  const started = await startTranscribeJob(db, { takeId, now });
  if (!started.ok) {
    return err(started.error === "invalid_transition" ? "not_ready" : started.error);
  }
  const dispatched = await dispatchJob(db, { jobId: started.data.id, trigger });
  if (!dispatched.ok) return err("dispatch_failed");
  return ok({ jobId: started.data.id });
}

/** True when the take has a queued or running transcribe job (other job starts wait for it). */
export async function hasActiveTranscribe(db: Executor, takeId: string): Promise<boolean> {
  const rows = await db
    .select({ status: processingJob.status })
    .from(processingJob)
    .where(and(eq(processingJob.takeId, takeId), eq(processingJob.kind, "transcribe")));
  return rows.some((r) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(r.status));
}
