import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, task } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { type JobDb, withJobDb } from "@/db/client/job";
import { reanalyse } from "@/db/data/cuts";
import { discardJobRenders, finish, markRunning, updateStep } from "@/db/data/jobs";
import { completeLatest, create as createRender } from "@/db/data/renders";
import { jobStep, processingJob, take } from "@/db/schema";
import { runTx } from "@/db/tx";
import { ok } from "@/lib/result";
import { renderKey } from "@/lib/cut-rules";
import type { FailureCode } from "@/lib/failure-codes";
import { parseJobEnv } from "@/lib/env";
import { isFinalJobStatus, type StepName } from "@/lib/processing";
import { type R2, createR2 } from "@/lib/r2";
import { downloadToFile, uploadFileMultipart } from "@/lib/r2-file-upload";
import {
  cutsFromSilences,
  keepRanges,
  outputFps,
  parseSilences,
  renderFilterScript,
  silencedetectFilter,
  throttledProgress,
  totalMs,
} from "@/lib/trim";
import { RENDER_UPLOAD } from "@/lib/uploads";
import { MediaToolError, probeFile, runFfmpeg } from "./media";

/**
 * `process-take` (spec 0004, Flow steps 5 and 6; AC-5, AC-6, AC-7, AC-10). Dispatched by the
 * probe with the job ID only (idempotency key `job-{jobId}`).
 *
 * markRunning → discard renders left by an earlier attempt → download the original → probe it
 * locally (media facts never travel in payloads) → trim (silencedetect + AC-5 rules →
 * `cuts.reanalyse`) → if there is no audio or no cut, skip the render and succeed with no render
 * (AC-7) → else render (snapshot of applied cuts → trim/atrim + concat, CFR, HDR tone map,
 * libx264 CRF 18, AAC 192k, faststart) → multipart upload → completeLatest → finish.
 * A retry never charges again (charging happens at job start). On final failure `onFailure`
 * fails the job: ffmpeg → `ffmpeg_error`, maxDuration → `timeout`, anything else →
 * `internal_error`, all refundable.
 */
export const processTakeTask = task({
  id: "process-take",
  machine: "large-1x",
  maxDuration: 40 * 60,
  retry: { maxAttempts: 2 },
  run: async (payload: { readonly jobId: string }, { ctx }) => {
    const env = parseJobEnv();
    const r2 = createR2(env);
    // One job client for the whole run (progress writes every few seconds would otherwise
    // open a connection each time); postgres.js reconnects if the pooler drops it while idle.
    return withJobDb(env.DATABASE_URL, (client) =>
      processJob(client, payload.jobId, ctx.run.id, r2),
    );
  },
  onFailure: async ({ payload, error }) => {
    const code = failureCodeFor(error);
    const env = parseJobEnv();
    await withJobDb(env.DATABASE_URL, async (d) => {
      // The step that was running when it failed gets the code too.
      const running = await d
        .select({ name: jobStep.name, progress: jobStep.progress })
        .from(jobStep)
        .where(and(eq(jobStep.jobId, payload.jobId), eq(jobStep.status, "running")));
      for (const s of running) {
        await updateStep(d, {
          jobId: payload.jobId,
          name: s.name as StepName,
          status: "failed",
          progress: s.progress,
          failureCode: code,
        });
      }
      await finish(d, { jobId: payload.jobId, status: "failed", failureCode: code });
    });
  },
});

/** The work of one attempt, on one database client. */
async function processJob(client: JobDb, jobId: string, runId: string, r2: R2) {
  const db = <T>(fn: (d: JobDb) => Promise<T>) => fn(client);
  const payload = { jobId };
  const ctx = { run: { id: runId } };
  const loaded = await db(async (d) => {
    const [job] = await d.select().from(processingJob).where(eq(processingJob.id, payload.jobId));
    if (!job || isFinalJobStatus(job.status)) return null;
    const [t] = await d.select().from(take).where(eq(take.id, job.takeId));
    if (!t) return null;
    await markRunning(d, { jobId: job.id, triggerRunId: ctx.run.id });
    // A retry starts the render again: drop what an earlier attempt left behind.
    await runTx(d, async (tx) => ok(await discardJobRenders(tx, { takeId: t.id, jobId: job.id })));
    return { job, take: t };
  });
  if (!loaded) {
    logger.info("process-take: job or take gone, or already final", { jobId: payload.jobId });
    return { jobId: payload.jobId, outcome: "skipped" as const };
  }
  const { job, take: t } = loaded;
  const step = (name: StepName, status: "running" | "succeeded" | "skipped", progress: number) =>
    db((d) => updateStep(d, { jobId: job.id, name, status, progress }));

  const work = await mkdtemp(join(tmpdir(), `take-${t.id}-`));
  try {
    // Download and re probe the original locally.
    const source = join(work, `source.${t.container}`);
    await downloadToFile(await r2.presignGet(t.originalKey, { expiresSeconds: 60 * 60 }), source);
    const facts = await probeFile(source);
    if (!facts) throw new MediaToolError("ffprobe", null, false);

    // Trim.
    await step("trim", "running", 0);
    if (!facts.hasAudio) {
      await step("trim", "skipped", 0);
      await step("render", "skipped", 0);
      await db((d) => finish(d, { jobId: job.id, status: "succeeded" }));
      return { jobId: job.id, takeId: t.id, outcome: "no_audio" as const };
    }
    const trimProgress = throttledProgress((p) => step("trim", "running", p));
    const stderr = await runFfmpeg(
      ["-i", source, "-vn", "-af", silencedetectFilter(), "-f", "null", "-"],
      {
        timeoutMs: 15 * 60_000,
        onOutTimeMs: (ms) => void trimProgress.report((ms / facts.durationMs) * 100),
      },
    );
    const proposed = cutsFromSilences(parseSilences(stderr, facts.durationMs), facts.durationMs);
    const analysed = await db((d) => reanalyse(d, { takeId: t.id, proposed }));
    if (!analysed.ok) throw new Error(`reanalyse failed: ${analysed.error}`);
    await step("trim", "succeeded", 100);

    if (!analysed.data.cuts.some((c) => c.applied)) {
      await step("render", "skipped", 0);
      await db((d) => finish(d, { jobId: job.id, status: "succeeded" }));
      return { jobId: job.id, takeId: t.id, outcome: "no_cuts" as const };
    }

    // Render.
    await step("render", "running", 0);
    const created = await db((d) => createRender(d, { takeId: t.id, jobId: job.id }));
    if (!created.ok) throw new Error(`render create failed: ${created.error}`);
    const renderId = created.data.id;
    const keep = keepRanges(created.data.removedRanges, facts.durationMs);
    const expectedMs = totalMs(keep);
    const script = join(work, "graph.txt");
    await writeFile(script, renderFilterScript(keep, facts.hdrTransfer));
    const output = join(work, "render.mp4");
    const renderProgress = throttledProgress((p) => step("render", "running", p));
    await runFfmpeg(
      [
        "-y",
        "-i",
        source,
        "-filter_complex_script",
        script,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-fps_mode",
        "cfr",
        "-r",
        outputFps(facts.fps),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        ...(facts.hdrTransfer
          ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
          : []),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output,
      ],
      {
        timeoutMs: 38 * 60_000,
        // Encoding is most of the render step; the upload takes the last few points.
        onOutTimeMs: (ms) => void renderProgress.report((ms / expectedMs) * 95),
      },
    );
    await rm(source, { force: true });
    await renderProgress.flush();

    const rendered = await probeFile(output);
    if (!rendered) throw new MediaToolError("ffprobe", null, false);
    await uploadFileMultipart(r2, renderKey(t.id, renderId), output, {
      contentType: "video/mp4",
      partSize: RENDER_UPLOAD.partSize,
      attempts: RENDER_UPLOAD.attempts,
    });
    const completed = await db((d) =>
      completeLatest(d, { renderId, durationMs: rendered.durationMs }),
    );
    if (!completed.ok) throw new Error(`render complete failed: ${completed.error}`);
    await step("render", "succeeded", 100);
    const finished = await db((d) => finish(d, { jobId: job.id, status: "succeeded" }));
    if (!finished.ok) throw new Error(`finish failed: ${finished.error}`);

    return {
      jobId: job.id,
      takeId: t.id,
      outcome: "rendered" as const,
      renderId,
      cuts: analysed.data.cuts.length,
      removedMs: facts.durationMs - expectedMs,
      renderMs: rendered.durationMs,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Failure code for a final error (spec 0004 Flow step 5). All three are refundable. */
export function failureCodeFor(error: unknown): FailureCode {
  if (
    error instanceof MediaToolError ||
    (error as { name?: string } | null)?.name === "MediaToolError"
  ) {
    return "ffmpeg_error";
  }
  const text = `${(error as { name?: string } | null)?.name ?? ""} ${String((error as { message?: string } | null)?.message ?? "")}`;
  if (/max.?duration|MAX_DURATION/i.test(text)) return "timeout";
  return "internal_error";
}
