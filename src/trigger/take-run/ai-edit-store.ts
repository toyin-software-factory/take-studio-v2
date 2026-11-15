import { and, eq } from "drizzle-orm";
import { reanalyse } from "@/db/data/cuts";
import { setTakeSuggestion } from "@/db/data/backgrounds";
import { updateStep, whileJobActive } from "@/db/data/jobs";
import { setTranscriptEdits } from "@/db/data/transcripts";
import { cut, jobStep } from "@/db/schema";
import type { Tx } from "@/db/types";
import type { ValidAiEdit } from "@/lib/ai-edit";
import { type Result, err, ok } from "@/lib/result";
import type { RunContext } from "./context";

/** The database side of the `ai_edit` step: reads of its own step rows and the guarded writes. */

/** The job was cancelled or finished under the step: the run stops, the step is not touched. */
export class RunStopped extends Error {}

/** True when this job already ended its `ai_edit` step (attempt 2): its results are committed. */
export async function aiEditAlreadyFinal(ctx: RunContext): Promise<boolean> {
  const [step] = await ctx.client
    .select({ status: jobStep.status })
    .from(jobStep)
    .where(and(eq(jobStep.jobId, ctx.job.id), eq(jobStep.name, "ai_edit")));
  return step?.status === "succeeded" || step?.status === "skipped";
}

/** Whether the take has any applied cut right now. */
export async function storedHasCuts(ctx: RunContext): Promise<boolean> {
  const rows = await ctx.client
    .select({ id: cut.id })
    .from(cut)
    .where(and(eq(cut.takeId, ctx.take.id), eq(cut.applied, true)))
    .limit(1);
  return rows.length > 0;
}

/** The skip reason the in run transcript step ended with, when it was skipped. */
export async function transcriptSkipReason(ctx: RunContext): Promise<"not_english" | "no_speech"> {
  const [step] = await ctx.client
    .select({ failureCode: jobStep.failureCode })
    .from(jobStep)
    .where(and(eq(jobStep.jobId, ctx.job.id), eq(jobStep.name, "transcript")));
  return step?.failureCode === "not_english" ? "not_english" : "no_speech";
}

/**
 * Final `skipped` status in a guarded transaction. The fixes and the background suggestion are
 * cleared here on fallback.
 */
export async function setFinal(
  ctx: RunContext,
  reason: "ai_unavailable" | "not_english" | "no_speech",
): Promise<void> {
  const done = await whileJobActive(
    ctx.client,
    ctx.job.id,
    async (tx) => {
      await setTranscriptEdits(tx, ctx.take.id, []);
      await setTakeSuggestion(tx, ctx.take.id, null);
      const step = await updateStep(tx, {
        jobId: ctx.job.id,
        name: "ai_edit",
        status: "skipped",
        progress: 0,
        failureCode: reason,
      });
      return step.ok ? ok(true) : err("invalid" as const);
    },
    ctx.signal,
  );
  if (!done.ok && (done.error === "job_final" || done.error === "aborted")) {
    ctx.signal.throwIfAborted();
    throw new RunStopped(`ai edit status write refused: ${done.error}`);
  }
}

/** Cuts, the seam for fixes and suggestion, and the final status, in one transaction. */
export async function writeValid(
  tx: Tx,
  ctx: RunContext,
  edit: ValidAiEdit,
): Promise<Result<boolean, "invalid">> {
  const analysed = await reanalyse(tx, { takeId: ctx.take.id, proposed: edit.cuts });
  if (!analysed.ok) return err("invalid");
  await setTranscriptEdits(
    tx,
    ctx.take.id,
    edit.fixes.map((fix) => ({ ...fix, undone: false })),
  );
  await setTakeSuggestion(
    tx,
    ctx.take.id,
    edit.background ? { backgroundId: edit.background.id, reason: edit.background.reason } : null,
  );
  const step = await updateStep(tx, {
    jobId: ctx.job.id,
    name: "ai_edit",
    status: "succeeded",
    progress: 100,
  });
  if (!step.ok) return err("invalid");
  return ok(analysed.data.cuts.some((c) => c.applied));
}

export async function setStepRunning(ctx: RunContext): Promise<void> {
  await updateStep(ctx.client, {
    jobId: ctx.job.id,
    name: "ai_edit",
    status: "running",
    progress: 0,
  });
}
