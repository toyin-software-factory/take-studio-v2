import { rm } from "node:fs/promises";
import { finish, queueDeletions, whileJobActive } from "@/db/data/jobs";
import { completeLatest } from "@/db/data/renders";
import { renderKey } from "@/lib/cut-rules";
import { uploadFileMultipart } from "@/lib/r2-file-upload";
import { RENDER_UPLOAD } from "@/lib/uploads";
import { queueTakeEmail } from "../email/queue";
import { MediaToolError, probeFile } from "../media";
import { type RunContext, type RunResult, setStep } from "./context";
import type { Encoded } from "./render";
import { startTranscript } from "./transcript";

/**
 * Uploads the encoded file, completes the render row and finishes the job. `withTranscript` is
 * true for a full run (a background change starts no transcript).
 */
export async function ship(
  ctx: RunContext,
  encoded: Encoded,
  options: { readonly withTranscript: boolean },
): Promise<RunResult> {
  const { client, r2, job, signal, source, facts } = ctx;
  const t = ctx.take;
  const { renderId, output } = encoded;
  await rm(source, { force: true });
  await encoded.flushProgress();

  const rendered = await probeFile(output, signal);
  if (!rendered) throw new MediaToolError("ffprobe", null, false);
  await uploadFileMultipart(r2, renderKey(t.id, renderId), output, {
    contentType: "video/mp4",
    partSize: RENDER_UPLOAD.partSize,
    attempts: RENDER_UPLOAD.attempts,
    signal,
  });
  const completed = await whileJobActive(
    client,
    job.id,
    (tx) => completeLatest(tx, { renderId, durationMs: rendered.durationMs }),
    signal,
  );
  if (!completed.ok) {
    // The job was cancelled or finished while we uploaded: the file is not tracked by any
    // render row. Queue its key (a no op if the cancel already queued it); if the queue
    // write fails, delete the object now. If that fails too, the error surfaces (the run
    // fails visibly) instead of the file being forgotten.
    const key = renderKey(t.id, renderId);
    try {
      await queueDeletions(client, [key]);
    } catch {
      await r2.deleteObject(key);
    }
    throw new Error(`render complete failed: ${completed.error}`);
  }
  await setStep(ctx, "render", "succeeded", 100);
  signal.throwIfAborted();
  const finished = await finish(client, { jobId: job.id, status: "succeeded" });
  if (!finished.ok) throw new Error(`finish failed: ${finished.error}`);
  await queueTakeEmail(job.id, job.kind);
  if (options.withTranscript) await startTranscript(client, t.id);

  return {
    jobId: job.id,
    takeId: t.id,
    outcome: "rendered",
    renderId,
    keyed: encoded.keyed,
    removedMs: facts.durationMs - encoded.expectedMs,
    renderMs: rendered.durationMs,
  };
}
