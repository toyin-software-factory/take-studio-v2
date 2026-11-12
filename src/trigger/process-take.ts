import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, task } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { type JobDb, withJobDb } from "@/db/client/job";
import { reanalyse } from "@/db/data/cuts";
import { dispatchJob } from "@/db/data/dispatch";
import {
  discardJobRenders,
  finish,
  markRunning,
  queueDeletions,
  startTranscribeJob,
  updateStep,
  whileJobActive,
} from "@/db/data/jobs";
import { completeLatest, create as createRender } from "@/db/data/renders";
import { background, jobStep, processingJob, take } from "@/db/schema";
import { runTx } from "@/db/tx";
import { ok } from "@/lib/result";
import { renderKey } from "@/lib/cut-rules";
import type { FailureCode } from "@/lib/failure-codes";
import { parseJobEnv } from "@/lib/env";
import {
  isBackgroundChange as isBackgroundChangeJob,
  isFinalJobStatus,
  type StepName,
} from "@/lib/processing";
import { type R2, createR2 } from "@/lib/r2";
import { R2DownloadError, downloadToFile, uploadFileMultipart } from "@/lib/r2-file-upload";
import {
  alignToFrames,
  cutsFromSilences,
  keepRanges,
  outputFps,
  parseSilences,
  renderFilterScript,
  silencedetectFilter,
  throttledProgress,
  totalMs,
} from "@/lib/trim";
import { triggerForTranscribe } from "@/lib/trigger-runs";
import { deadlineMs, isDeadlineExceeded, runWithDeadline } from "@/lib/deadline";
import { JOB_ERROR_NAMES, hasJobErrorName } from "@/lib/job-errors";
import { PROCESS_TAKE_LIMITS } from "@/lib/cleanup-rules";
import { RENDER_UPLOAD } from "@/lib/uploads";
import { queueTakeEmail } from "./email/queue";
import { toHex } from "@/lib/keying";
import { BackgroundMissingError, detectInFile } from "./keying";
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
  maxDuration: PROCESS_TAKE_LIMITS.maxDurationSeconds,
  retry: { maxAttempts: PROCESS_TAKE_LIMITS.maxAttempts },
  // Per creator: every run is triggered with the concurrency key `creator-{id}` (`triggerForJob`),
  // so each creator gets a queue of this size and cannot take every slot.
  queue: { concurrencyLimit: PROCESS_TAKE_LIMITS.perCreatorConcurrency },
  run: async (payload: { readonly jobId: string }, { ctx }) => {
    const env = parseJobEnv();
    const r2 = createR2(env);
    // One job client for the whole run (progress writes every few seconds would otherwise
    // open a connection each time); postgres.js reconnects if the pooler drops it while idle.
    // Stops itself 90 s before maxDuration (Trigger.dev skips onFailure past it): work is
    // aborted, temp files go, then DeadlineExceeded reaches onFailure as `timeout`.
    return runWithDeadline(deadlineMs(PROCESS_TAKE_LIMITS.maxDurationSeconds), (signal) =>
      withJobDb(env.DATABASE_URL, (client) =>
        processJob(client, payload.jobId, ctx.run.id, r2, signal),
      ),
    );
  },
  onFailure: async ({ payload, error }) => {
    const code = failureCodeFor(error);
    const env = parseJobEnv();
    const kind = await withJobDb(env.DATABASE_URL, async (d) => {
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
      const [row] = await d
        .select({ kind: processingJob.kind })
        .from(processingJob)
        .where(eq(processingJob.id, payload.jobId));
      return row?.kind ?? null;
    });
    if (kind) await queueTakeEmail(payload.jobId, kind);
  },
});

/** The work of one attempt, on one database client. */
async function processJob(
  client: JobDb,
  jobId: string,
  runId: string,
  r2: R2,
  signal: AbortSignal,
) {
  const db = <T>(fn: (d: JobDb) => Promise<T>) => fn(client);
  const payload = { jobId };
  const ctx = { run: { id: runId } };
  const loaded = await db(async (d) => {
    const [job] = await d.select().from(processingJob).where(eq(processingJob.id, payload.jobId));
    if (!job || isFinalJobStatus(job.status)) return null;
    const [t] = await d.select().from(take).where(eq(take.id, job.takeId));
    if (!t) return null;
    // Rejected means the job was cancelled or finished meanwhile: stop, do no work.
    const running = await markRunning(d, { jobId: job.id, triggerRunId: ctx.run.id });
    if (!running.ok) return null;
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
    await downloadToFile(
      await r2.presignGet(t.originalKey, { expiresSeconds: 60 * 60 }),
      source,
      signal,
    );
    const facts = await probeFile(source, signal);
    if (!facts) throw new MediaToolError("ffprobe", null, false);

    // A background change (spec 0008): a job of kind `background`, on a take that is already
    // Ready. It reuses the take's applied cuts (the render snapshot reads them), so it neither
    // trims nor re analyses, always renders, and starts no transcript. A `rerender` (a re render
    // of a take that failed, take `processing`) is a full run again, as before. LEGACY (HRF-T08
    // deploy window): a `rerender` on a take that is not `processing` is still a background
    // change (`isBackgroundChange` in `src/lib/processing.ts`).
    const isBackgroundChange = isBackgroundChangeJob(job.kind, t.status);

    // Trim. A take with no sound has nothing to trim: with no background it ends here (the
    // original is the video); with one it still renders, below.
    if (!isBackgroundChange) await step("trim", "running", 0);
    if (!isBackgroundChange && !facts.hasAudio) {
      await step("trim", "skipped", 0);
      if (!job.targetBackgroundId) {
        await step("render", "skipped", 0);
        signal.throwIfAborted();
        await db((d) => finish(d, { jobId: job.id, status: "succeeded" }));
        await queueTakeEmail(job.id, job.kind);
        // The transcript job skips it as `no_speech` without calling Deepgram (spec 0007, AC-7).
        await startTranscript(client, t.id);
        return { jobId: job.id, takeId: t.id, outcome: "no_audio" as const };
      }
    }
    let hasCuts = false;
    if (!isBackgroundChange && facts.hasAudio) {
      const trimProgress = throttledProgress((p) => step("trim", "running", p));
      const stderr = await runFfmpeg(
        ["-i", source, "-vn", "-af", silencedetectFilter(), "-f", "null", "-"],
        {
          timeoutMs: 15 * 60_000,
          signal,
          onOutTimeMs: (ms) => void trimProgress.report((ms / facts.durationMs) * 100),
        },
      );
      const proposed = cutsFromSilences(parseSilences(stderr, facts.durationMs), facts.durationMs);
      signal.throwIfAborted();
      const analysed = await db((d) =>
        whileJobActive(d, job.id, (tx) => reanalyse(tx, { takeId: t.id, proposed }), signal),
      );
      if (!analysed.ok) throw new Error(`reanalyse failed: ${analysed.error}`);
      await trimProgress.flush();
      await step("trim", "succeeded", 100);
      hasCuts = analysed.data.cuts.some((c) => c.applied);
    }

    // Background (spec 0008): find the green screen and its colour; none usable keeps the
    // original background and the step ends skipped.
    let backgroundFacts: {
      readonly id: string;
      readonly name: string;
      readonly imagePath: string;
      readonly keyColor: string | null;
    } | null = null;
    if (job.targetBackgroundId) {
      await step("background", "running", 0);
      const [bg] = await db((d) =>
        d.select().from(background).where(eq(background.id, job.targetBackgroundId!)),
      );
      if (!bg || bg.status !== "ready" || !bg.imageKey) throw new BackgroundMissingError();
      const imagePath = join(work, "background.jpg");
      try {
        await downloadToFile(
          await r2.presignGet(bg.imageKey, { expiresSeconds: 60 * 60 }),
          imagePath,
          signal,
        );
      } catch (error) {
        // The row is ready but its image is gone from R2: the job's own code (spec 0008).
        if (error instanceof R2DownloadError && error.status === 404) {
          throw new BackgroundMissingError();
        }
        throw error;
      }
      const detection = await detectInFile(source, facts, signal);
      backgroundFacts = {
        id: bg.id,
        name: bg.name,
        imagePath,
        keyColor: detection.usable ? toHex(detection.keyColor) : null,
      };
      if (detection.usable) {
        await step("background", "succeeded", 100);
      } else {
        await db((d) =>
          updateStep(d, {
            jobId: job.id,
            name: "background",
            status: "skipped",
            progress: 0,
            failureCode: "no_green_screen",
          }),
        );
      }
    }
    const keyed = backgroundFacts?.keyColor != null;

    // Spec 0008 AC-2: a take with a chosen background is always rendered (the whole take when
    // there are no cuts), keyed or not, so the render records which background it was for.
    if (!isBackgroundChange && !hasCuts && !backgroundFacts) {
      await step("render", "skipped", 0);
      signal.throwIfAborted();
      await db((d) => finish(d, { jobId: job.id, status: "succeeded" }));
      await queueTakeEmail(job.id, job.kind);
      await startTranscript(client, t.id);
      return { jobId: job.id, takeId: t.id, outcome: "no_cuts" as const };
    }

    // Render.
    await step("render", "running", 0);
    const created = await db((d) =>
      whileJobActive(
        d,
        job.id,
        (tx) =>
          createRender(tx, {
            takeId: t.id,
            jobId: job.id,
            background: backgroundFacts
              ? {
                  backgroundId: backgroundFacts.id,
                  backgroundName: backgroundFacts.name,
                  keyed,
                  keyColor: backgroundFacts.keyColor,
                }
              : undefined,
          }),
        signal,
      ),
    );
    if (!created.ok) throw new Error(`render create failed: ${created.error}`);
    const renderId = created.data.id;
    const keep = alignToFrames(keepRanges(created.data.removedRanges, facts.durationMs), facts.fps);
    if (keep.length === 0) {
      // Every range collapsed when snapped to frames: nothing would be left to render.
      throw new Error("render has nothing to keep: the cuts remove the whole take");
    }
    const expectedMs = totalMs(keep);
    const script = join(work, "graph.txt");
    await writeFile(
      script,
      renderFilterScript(keep, {
        hdr: facts.hdrTransfer,
        hasAudio: facts.hasAudio,
        background:
          keyed && backgroundFacts?.keyColor
            ? { keyColor: backgroundFacts.keyColor, width: facts.width, height: facts.height }
            : undefined,
      }),
    );
    const output = join(work, "render.mp4");
    const renderProgress = throttledProgress((p) => step("render", "running", p));
    await runFfmpeg(
      [
        "-y",
        "-i",
        source,
        // The background image, looped at the output frame rate, is input 1 of the key graph.
        ...(keyed && backgroundFacts
          ? ["-loop", "1", "-framerate", outputFps(facts.fps), "-i", backgroundFacts.imagePath]
          : []),
        "-filter_complex_script",
        script,
        "-map",
        "[vout]",
        ...(facts.hasAudio ? ["-map", "[aout]"] : []),
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
        ...(facts.hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
        "-movflags",
        "+faststart",
        output,
      ],
      {
        timeoutMs: 38 * 60_000,
        signal,
        // Encoding is most of the render step; the upload takes the last few points.
        onOutTimeMs: (ms) => void renderProgress.report((ms / expectedMs) * 95),
      },
    );
    await rm(source, { force: true });
    await renderProgress.flush();

    const rendered = await probeFile(output, signal);
    if (!rendered) throw new MediaToolError("ffprobe", null, false);
    await uploadFileMultipart(r2, renderKey(t.id, renderId), output, {
      contentType: "video/mp4",
      partSize: RENDER_UPLOAD.partSize,
      attempts: RENDER_UPLOAD.attempts,
      signal,
    });
    const completed = await db((d) =>
      whileJobActive(
        d,
        job.id,
        (tx) => completeLatest(tx, { renderId, durationMs: rendered.durationMs }),
        signal,
      ),
    );
    if (!completed.ok) {
      // The job was cancelled or finished while we uploaded: the file is not tracked by any
      // render row. Queue its key (a no op if the cancel already queued it); if the queue
      // write fails, delete the object now. If that fails too, the error surfaces (the run
      // fails visibly) instead of the file being forgotten.
      const key = renderKey(t.id, renderId);
      try {
        await db((d) => queueDeletions(d, [key]));
      } catch {
        await r2.deleteObject(key);
      }
      throw new Error(`render complete failed: ${completed.error}`);
    }
    await step("render", "succeeded", 100);
    signal.throwIfAborted();
    const finished = await db((d) => finish(d, { jobId: job.id, status: "succeeded" }));
    if (!finished.ok) throw new Error(`finish failed: ${finished.error}`);
    await queueTakeEmail(job.id, job.kind);
    if (!isBackgroundChange) await startTranscript(client, t.id);

    return {
      jobId: job.id,
      takeId: t.id,
      outcome: "rendered" as const,
      renderId,
      keyed,
      removedMs: facts.durationMs - expectedMs,
      renderMs: rendered.durationMs,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * After the video is Ready (spec 0007, Pipeline step 1): starts the take's transcribe job and
 * triggers `transcribe-take` (key `transcribe-{jobId}`; a throwing trigger finishes the job
 * `trigger_failed` at once, so it never sits queued). Never throws and never touches the
 * video job: a refused start (transcript exists, original gone) just leaves "Make transcript".
 */
async function startTranscript(client: JobDb, takeId: string): Promise<void> {
  // A thrown start (the database blinked) is tried 3 times; a retry of this task would exit
  // early because the video job is already final. A refused start is final, not retried. If
  // all three throw, the take shows "Make transcript" (spec 0007, Pipeline step 1).
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const started = await startTranscribeJob(client, { takeId });
      if (!started.ok) {
        logger.info("process-take: transcript not started", { takeId, reason: started.error });
        return;
      }
      const dispatched = await dispatchJob(client, {
        jobId: started.data.id,
        trigger: triggerForTranscribe(),
      });
      if (!dispatched.ok) {
        logger.warn("process-take: transcript trigger failed", { takeId, jobId: started.data.id });
      }
      return;
    } catch {
      logger.warn("process-take: transcript start threw", { takeId, attempt });
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

/** Failure code for a final error (spec 0004 Flow step 5). All three are refundable. */
export function failureCodeFor(error: unknown): FailureCode {
  // The attempt stopped itself before maxDuration (src/lib/deadline.ts).
  if (isDeadlineExceeded(error)) return "timeout";
  // The background image vanished or was not ready while the job ran (spec 0008).
  if (
    error instanceof BackgroundMissingError ||
    hasJobErrorName(error, JOB_ERROR_NAMES.backgroundMissing)
  ) {
    return "background_missing";
  }
  if (error instanceof MediaToolError || hasJobErrorName(error, JOB_ERROR_NAMES.mediaTool)) {
    return "ffmpeg_error";
  }
  const text = `${(error as { name?: string } | null)?.name ?? ""} ${String((error as { message?: string } | null)?.message ?? "")}`;
  if (/max.?duration|MAX_DURATION/i.test(text)) return "timeout";
  return "internal_error";
}
