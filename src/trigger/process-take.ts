import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, task } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { type JobDb, withJobDb } from "@/db/client/job";
import { discardJobRenders, finish, markRunning, updateStep } from "@/db/data/jobs";
import { jobStep, processingJob, take } from "@/db/schema";
import { runTx } from "@/db/tx";
import { ok } from "@/lib/result";
import type { FailureCode } from "@/lib/failure-codes";
import { parseJobEnv } from "@/lib/env";
import {
  isBackgroundKind,
  isFinalJobStatus,
  isTranscribeKind,
  type StepName,
} from "@/lib/processing";
import { type R2, createR2 } from "@/lib/r2";
import { downloadToFile } from "@/lib/r2-file-upload";
import { deadlineMs, isDeadlineExceeded, runWithDeadline } from "@/lib/deadline";
import { JOB_ERROR_NAMES, hasJobErrorName } from "@/lib/job-errors";
import { PROCESS_TAKE_LIMITS } from "@/lib/cleanup-rules";
import { recordTakeFailed } from "./analytics/record";
import { queueTakeEmail } from "./email/queue";
import { BackgroundMissingError } from "./keying";
import { MediaToolError, probeFile } from "./media";
import { changeRun } from "./take-run/change-run";
import type { RunContext } from "./take-run/context";
import { fullRun } from "./take-run/full-run";

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
      const finished = await finish(d, {
        jobId: payload.jobId,
        status: "failed",
        failureCode: code,
      });
      const [row] = await d
        .select({ kind: processingJob.kind, takeId: processingJob.takeId })
        .from(processingJob)
        .where(eq(processingJob.id, payload.jobId));
      // Spec 0016 AC-4: only a video job that this call really failed; a background change or a
      // transcribe job leaves the take as it was. Best effort, never throws.
      if (finished.ok && row && !isBackgroundKind(row.kind) && !isTranscribeKind(row.kind)) {
        const [owner] = await d
          .select({ id: take.id, creatorId: take.creatorId })
          .from(take)
          .where(eq(take.id, row.takeId));
        if (owner) await recordTakeFailed(d, owner, code);
      }
      return row?.kind ?? null;
    });
    if (kind) await queueTakeEmail(payload.jobId, kind);
  },
});

/**
 * The work of one attempt, on one database client: load the job, download and probe the original
 * (the shared part), then hand over to the path the job kind picks (`src/trigger/take-run/`).
 */
async function processJob(
  client: JobDb,
  jobId: string,
  runId: string,
  r2: R2,
  signal: AbortSignal,
) {
  const loaded = await (async (d: JobDb) => {
    const [job] = await d.select().from(processingJob).where(eq(processingJob.id, jobId));
    if (!job || isFinalJobStatus(job.status)) return null;
    const [t] = await d.select().from(take).where(eq(take.id, job.takeId));
    if (!t) return null;
    // Rejected means the job was cancelled or finished meanwhile: stop, do no work.
    const running = await markRunning(d, { jobId: job.id, triggerRunId: runId });
    if (!running.ok) return null;
    // A retry starts the render again: drop what an earlier attempt left behind.
    await runTx(d, async (tx) => ok(await discardJobRenders(tx, { takeId: t.id, jobId: job.id })));
    return { job, take: t };
  })(client);
  if (!loaded) {
    logger.info("process-take: job or take gone, or already final", { jobId });
    return { jobId, outcome: "skipped" as const };
  }
  const { job, take: t } = loaded;

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
    const ctx: RunContext = { client, r2, signal, job, take: t, work, source, facts };

    // A background change (spec 0008): a job of kind `background`, on a take that is already
    // Ready. A `rerender` (a re render of a take that failed, take `processing`) is a full run
    // again, as before.
    return isBackgroundKind(job.kind) ? await changeRun(ctx) : await fullRun(ctx);
  } finally {
    await rm(work, { recursive: true, force: true });
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
