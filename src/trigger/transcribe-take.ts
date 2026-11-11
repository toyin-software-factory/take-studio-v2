import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { withJobDb } from "@/db/client/job";
import type { Executor } from "@/db/types";
import { finish, markRunning, updateStep } from "@/db/data/jobs";
import { saveTranscriptAndFinish } from "@/db/data/transcripts";
import { jobStep, processingJob, take } from "@/db/schema";
import { TRANSCRIBE_TAKE_LIMITS } from "@/lib/cleanup-rules";
import { DEEPGRAM_MODEL, deepgramUrl, parseDeepgramResponse } from "@/lib/deepgram";
import { type TranscriptEnv, parseJobEnv, parseTranscriptEnv } from "@/lib/env";
import type { FailureCode } from "@/lib/failure-codes";
import { isFinalJobStatus, type SkipReason } from "@/lib/processing";
import { type R2, createR2 } from "@/lib/r2";
import { MediaToolError, probeUrl, runFfmpeg } from "./media";
import { failureCodeFor } from "./process-take";

/**
 * `transcribe-take` (spec 0007, Pipeline step 2; AC-6, AC-7, AC-8, AC-11). Dispatched by
 * `process-take` (or later the Make transcript button) with the job ID only, key
 * `transcribe-{jobId}`. It never moves the take, never charges and never emails.
 *
 * markRunning → original missing? skip `original_gone` → presign, extract mono 16 kHz Opus in
 * Ogg (ffmpeg reads the presigned link; the link never leaves this process) → no audio stream?
 * skip `no_speech` without calling Deepgram → POST the bytes → zod check → English check →
 * words → upsert → finish. Never log text, audio, keys or links: IDs and counts only.
 */
export const transcribeTakeTask = task({
  id: "transcribe-take",
  machine: "medium-1x",
  maxDuration: TRANSCRIBE_TAKE_LIMITS.maxDurationSeconds,
  retry: { maxAttempts: TRANSCRIBE_TAKE_LIMITS.maxAttempts },
  run: async (payload: { readonly jobId: string }, { ctx }) => {
    // A missing key is a deploy mistake: stop now (names only), touching no other job.
    let transcriptEnv: TranscriptEnv;
    try {
      transcriptEnv = parseTranscriptEnv();
    } catch (error) {
      throw new AbortTaskRunError(
        error instanceof Error ? error.message : "Invalid transcript env",
      );
    }
    const env = parseJobEnv();
    const r2 = createR2(env);
    // Trigger.dev does not call `onFailure` when a run exceeds `maxDuration` (checked in a local
    // run: the run ends TIMED_OUT and the job would stay active until stale cleanup), so the
    // attempt stops itself a little earlier. The error then reaches `onFailure` like any other.
    return withDeadline(
      withJobDb(env.DATABASE_URL, (db) =>
        transcribeJob(db, payload.jobId, ctx.run.id, {
          r2,
          probe: probeUrl,
          extractAudio: extractWithFfmpeg,
          post: (audio) => postToDeepgram(audio, transcriptEnv.DEEPGRAM_API_KEY),
        }),
      ),
      (TRANSCRIBE_TAKE_LIMITS.maxDurationSeconds - ATTEMPT_MARGIN_SECONDS) * 1000,
    );
  },
  onFailure: async ({ payload, error }) => {
    const env = parseJobEnv();
    await withJobDb(env.DATABASE_URL, (d) => failTranscribeJob(d, payload.jobId, error));
  },
});

/** Seconds before `maxDuration` at which an attempt gives up on its own. */
const ATTEMPT_MARGIN_SECONDS = 30;

/** Rejects with `DeepgramTimeout` (final code `timeout`) when `work` takes longer than `ms`. */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeepgramTimeout()), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Failure code for a final error (spec 0007, AC-8): a rejected request (4xx) is
 * `provider_rejected`, a Deepgram timeout `timeout`, any other Deepgram failure (network, 429,
 * 5xx after the retries) `provider_error`, the rest as for `process-take`.
 */
export function transcribeFailureCode(error: unknown): FailureCode {
  if (error instanceof DeepgramRejected) return "provider_rejected";
  if (error instanceof DeepgramTimeout) return "timeout";
  if (error instanceof DeepgramError) return "provider_error";
  return failureCodeFor(error);
}

/** The final failure of a transcribe job: the running step and the job get the code. The take stays Ready. */
export async function failTranscribeJob(
  d: Executor,
  jobId: string,
  error: unknown,
): Promise<FailureCode> {
  const code = transcribeFailureCode(error);
  const running = await d
    .select({ name: jobStep.name, progress: jobStep.progress })
    .from(jobStep)
    .where(and(eq(jobStep.jobId, jobId), eq(jobStep.status, "running")));
  for (const s of running) {
    await updateStep(d, {
      jobId,
      name: s.name as "transcript",
      status: "failed",
      progress: s.progress,
      failureCode: code,
    });
  }
  await finish(d, { jobId, status: "failed", failureCode: code });
  return code;
}

/** Deepgram answered 5xx or 429, or the network failed: retried. Message holds no content. */
export class DeepgramError extends Error {
  override name = "DeepgramError";
  constructor(readonly status: number | null) {
    super(`Deepgram request failed (${status ?? "network"})`);
  }
}

/** The request outlived its 5 minute limit: retried, and `timeout` if it is the last attempt. */
export class DeepgramTimeout extends DeepgramError {
  override name = "DeepgramTimeout";
  constructor() {
    super(null);
  }
}

/** Deepgram refused the request (400, 402, 413, ...): not retried, one Sentry alert. */
export class DeepgramRejected extends AbortTaskRunError {
  constructor(readonly status: number) {
    super(`Deepgram rejected the request (${status})`);
    this.name = "DeepgramRejected";
  }
}

/** True for statuses worth another attempt. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** POSTs the audio to Deepgram; returns the parsed JSON body. Throws the two errors above. */
export async function postToDeepgram(
  audio: Uint8Array,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(deepgramUrl(), {
      method: "POST",
      headers: { authorization: `Token ${apiKey}`, "content-type": "audio/ogg" },
      body: audio as BodyInit,
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new DeepgramTimeout();
    throw new DeepgramError(null);
  }
  if (!response.ok) {
    if (isRetryableStatus(response.status)) throw new DeepgramError(response.status);
    throw new DeepgramRejected(response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    // The 5 minute signal also covers reading the body: a stalled body is a timeout, not bad JSON.
    if (error instanceof Error && error.name === "TimeoutError") throw new DeepgramTimeout();
    throw new DeepgramError(response.status);
  }
}

/** The outside world of one attempt, so tests can fake it (R2, ffmpeg and Deepgram). */
export type TranscribeIo = {
  readonly r2: Pick<R2, "headObject" | "presignGet">;
  readonly probe: typeof probeUrl;
  /** Writes the mono 16 kHz Opus file for the link to `outPath`. */
  readonly extractAudio: (link: string, outPath: string) => Promise<void>;
  readonly post: (audio: Uint8Array) => Promise<unknown>;
};

async function extractWithFfmpeg(link: string, outPath: string): Promise<void> {
  await runFfmpeg(
    [
      "-y",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-rw_timeout",
      "30000000",
      "-i",
      link,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      outPath,
    ],
    { timeoutMs: 10 * 60_000 },
  );
}

export async function transcribeJob(
  client: Executor,
  jobId: string,
  runId: string,
  io: TranscribeIo,
) {
  const { r2 } = io;
  const [job] = await client.select().from(processingJob).where(eq(processingJob.id, jobId));
  if (!job || isFinalJobStatus(job.status)) {
    logger.info("transcribe-take: job gone or already final", { jobId });
    return { jobId, outcome: "skipped" as const };
  }
  const [t] = await client.select().from(take).where(eq(take.id, job.takeId));
  const running = t ? await markRunning(client, { jobId, triggerRunId: runId }) : null;
  if (!t || !running?.ok) {
    logger.info("transcribe-take: take gone or job not runnable", { jobId });
    return { jobId, outcome: "skipped" as const };
  }

  const skip = async (reason: SkipReason) => {
    await updateStep(client, {
      jobId,
      name: "transcript",
      status: "skipped",
      progress: 0,
      failureCode: reason,
    });
    await finish(client, { jobId, status: "succeeded" });
    logger.info("transcribe-take: skipped", { jobId, reason });
    return { jobId, takeId: t.id, outcome: reason };
  };

  await updateStep(client, { jobId, name: "transcript", status: "running", progress: 0 });
  if (!(await r2.headObject(t.originalKey))) return skip("original_gone");

  const work = await mkdtemp(join(tmpdir(), `transcribe-${t.id}-`));
  try {
    const link = await r2.presignGet(t.originalKey, { expiresSeconds: 60 * 60 });
    const facts = await io.probe(link);
    if (!facts) throw new MediaToolError("ffprobe", null, false);
    if (!facts.hasAudio) return skip("no_speech");

    const audioPath = join(work, "audio.ogg");
    await io.extractAudio(link, audioPath);
    await updateStep(client, { jobId, name: "transcript", status: "running", progress: 40 });

    const body = await io.post(new Uint8Array(await readFile(audioPath)));
    const parsed = parseDeepgramResponse(body);
    if (parsed.kind === "invalid") throw new DeepgramError(200);
    if (parsed.kind !== "words") return skip(parsed.kind);

    const saved = await saveTranscriptAndFinish(client, jobId, {
      takeId: t.id,
      language: parsed.language,
      text: parsed.text,
      words: parsed.words,
      sourceFps: facts.fps ?? 30,
      model: DEEPGRAM_MODEL,
    });
    if (!saved.ok) {
      if (saved.error === "job_final") {
        // Cleanup failed or cancelled this job while we worked: publish nothing.
        logger.info("transcribe-take: job already final, nothing saved", { jobId });
        return { jobId, outcome: "job_final" as const };
      }
      throw new Error("transcribe finish failed");
    }
    if (!saved.data.saved) return { jobId, outcome: "take_gone" as const };
    logger.info("transcribe-take: saved", { jobId, takeId: t.id, words: parsed.words.length });
    return { jobId, takeId: t.id, outcome: "saved" as const, words: parsed.words.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
