import { finish } from "@/db/data/jobs";
import { queueTakeEmail } from "../email/queue";
import { type RunContext, type RunResult, setStep } from "./context";
import { startTranscript } from "./transcript";

/**
 * Ends a full run that has nothing to render (AC-7): the render step is skipped and the job
 * succeeds with no render, the original is the video. The email is queued and the transcript
 * started (a take with no sound is skipped there as `no_speech`, without calling Deepgram,
 * spec 0007 AC-7).
 */
export async function finishWithoutRender(
  ctx: RunContext,
  outcome: "no_audio" | "no_cuts",
): Promise<RunResult> {
  const { client, job, signal, take } = ctx;
  await setStep(ctx, "render", "skipped", 0);
  signal.throwIfAborted();
  await finish(client, { jobId: job.id, status: "succeeded" });
  await queueTakeEmail(job.id, job.kind);
  await startTranscript(client, take.id);
  return { jobId: job.id, takeId: take.id, outcome };
}
