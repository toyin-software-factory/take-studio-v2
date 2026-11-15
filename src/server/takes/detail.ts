import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { background, jobStep, processingJob, render, take, transcript } from "@/db/schema";
import type { Executor, JobStep, ProcessingJob, Render, Take } from "@/db/types";
import { type Result, err, ok } from "@/lib/result";

export type AiEditState = "done" | "unavailable";

/** `succeeded` is `done`, `skipped ai_unavailable` is `unavailable`, anything else is unknown. */
export function aiEditState(
  step: { readonly status: string; readonly failureCode: string | null } | undefined,
): AiEditState | null {
  if (step?.status === "succeeded") return "done";
  if (step?.status === "skipped" && step.failureCode === "ai_unavailable") return "unavailable";
  return null;
}

export type TakeDetail = {
  readonly take: Take;
  readonly latestRender: Render | null;
  readonly latestJob: (ProcessingJob & { readonly steps: readonly JobStep[] }) | null;
  /** The background the finished video is on (green replaced); null when it is the original. */
  readonly background: { readonly id: string | null; readonly name: string } | null;
  /** B2-T156: the source frame rate the render snapped its cuts to (transcript row); null when no transcript. */
  readonly sourceFps: number | null;
  /** The take has no usable green screen, so its background request kept the original (AC-3). */
  readonly noGreenScreen: boolean;
  /** Spec 0012: how the AI edit of the latest finished full run ended; null when unknown. */
  readonly aiEdit: AiEditState | null;
  /** Spec 0012 AC-5: the AI's background suggestion (built in only); null when none. */
  readonly suggestion: {
    readonly backgroundId: string;
    readonly name: string;
    readonly reason: string;
  } | null;
  /** The latest background change job (a `background` job), for "Try again". */
  readonly backgroundJob: {
    readonly status: string;
    readonly failureCode: string | null;
    /** The background that change was for (null is the original), so "Try again" repeats it. */
    readonly targetBackgroundId: string | null;
  } | null;
};

/** `takes.getForCreator`: the take with its latest render and latest job (with steps). */
export async function getForCreator(
  db: Executor,
  creatorId: string,
  takeId: string,
): Promise<Result<TakeDetail, "not_found">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");
  const [found] = await db
    .select()
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  if (!found) return err("not_found");

  const [latestJob] = await db
    .select()
    .from(processingJob)
    // Transcribe jobs have their own panel; the progress view follows video jobs only.
    .where(and(eq(processingJob.takeId, takeId), ne(processingJob.kind, "transcribe")))
    .orderBy(desc(processingJob.createdAt))
    .limit(1);
  const steps = latestJob
    ? await db
        .select()
        .from(jobStep)
        .where(eq(jobStep.jobId, latestJob.id))
        .orderBy(asc(jobStep.position))
    : [];

  // The latest background change: the latest job of kind `background`.
  const [backgroundJob] = await db
    .select({
      status: processingJob.status,
      failureCode: processingJob.failureCode,
      targetBackgroundId: processingJob.targetBackgroundId,
    })
    .from(processingJob)
    .where(and(eq(processingJob.takeId, takeId), eq(processingJob.kind, "background")))
    .orderBy(desc(processingJob.createdAt))
    .limit(1);

  // The AI edit of the latest succeeded full run (older takes have no such step: null).
  const [aiStep] = await db
    .select({ status: jobStep.status, failureCode: jobStep.failureCode })
    .from(jobStep)
    .innerJoin(processingJob, eq(processingJob.id, jobStep.jobId))
    .where(
      and(
        eq(processingJob.takeId, takeId),
        eq(processingJob.status, "succeeded"),
        inArray(processingJob.kind, ["initial", "rerender"]),
        eq(jobStep.name, "ai_edit"),
      ),
    )
    .orderBy(desc(processingJob.createdAt))
    .limit(1);

  // The suggestion, named by a join so a deleted background (ID set null) reads as none.
  const [suggested] = found.suggestedBackgroundId
    ? await db
        .select({ id: background.id, name: background.name })
        .from(background)
        .where(and(eq(background.id, found.suggestedBackgroundId), isNull(background.creatorId)))
    : [];

  // Read last on purpose: a job finishes and swaps the latest render in one transaction, so a
  // job read as `succeeded` above means this read already sees its render (the other order could
  // show a finished change with the old video's background name until the next poll).
  const [latestRender] = await db
    .select()
    .from(render)
    .where(and(eq(render.takeId, takeId), eq(render.isLatest, true)));

  const [fpsRow] = await db
    .select({ sourceFps: transcript.sourceFps })
    .from(transcript)
    .where(eq(transcript.takeId, takeId));

  const keyedBackground =
    latestRender?.keyed && latestRender.backgroundName
      ? { id: latestRender.backgroundId, name: latestRender.backgroundName }
      : null;
  // The render's own snapshot, or a job that is running or succeeded and skipped the green
  // screen. A failed or cancelled job never produced the video on the page, so it does not count.
  const noGreenScreen =
    (latestRender?.backgroundName != null && latestRender.keyed === false) ||
    (latestJob?.status !== "failed" &&
      latestJob?.status !== "cancelled" &&
      steps.some((s) => s.name === "background" && s.failureCode === "no_green_screen"));

  return ok({
    take: found,
    latestRender: latestRender ?? null,
    latestJob: latestJob ? { ...latestJob, steps } : null,
    background: keyedBackground,
    noGreenScreen,
    sourceFps: fpsRow?.sourceFps ?? null,
    aiEdit: aiEditState(aiStep),
    suggestion:
      suggested && found.suggestionReason
        ? { backgroundId: suggested.id, name: suggested.name, reason: found.suggestionReason }
        : null,
    backgroundJob: backgroundJob ?? null,
  });
}
