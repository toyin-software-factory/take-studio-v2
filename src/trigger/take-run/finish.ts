import { logger } from "@trigger.dev/sdk";
import { finish } from "@/db/data/jobs";
import { recordTakeReady } from "../analytics/record";
import { queueTakeEmail } from "../email/queue";
import { type RunContext, type RunResult, setStep } from "./context";
import { startTranscript } from "./transcript";

/**
 * Ends a full run that has nothing to render (AC-7): the render step is skipped and the job
 * succeeds with no render, the original is the video. The email is queued, and the separate
 * transcribe job is started only when `withTranscript` says the in run transcript step failed
 * (spec 0012; a take with no sound is skipped `no_speech` in the run). If the finish is refused (the job was cancelled or finished meanwhile), no
 * email is queued and no transcript started.
 */
export async function finishWithoutRender(
  ctx: RunContext,
  outcome: "no_audio" | "no_cuts",
  options: { readonly withTranscript: boolean },
): Promise<RunResult> {
  const { client, job, signal, take } = ctx;
  await setStep(ctx, "render", "skipped", 0);
  signal.throwIfAborted();
  const finished = await finish(client, { jobId: job.id, status: "succeeded" });
  if (!finished.ok) {
    logger.info("process-take: finish refused, no email or transcript", {
      jobId: job.id,
      takeId: take.id,
      reason: finished.error,
    });
    return { jobId: job.id, takeId: take.id, outcome: "not_finished" };
  }
  await recordTakeReady(client, job, take);
  await queueTakeEmail(job.id, job.kind);
  if (options.withTranscript) await startTranscript(client, take.id);
  return { jobId: job.id, takeId: take.id, outcome };
}
