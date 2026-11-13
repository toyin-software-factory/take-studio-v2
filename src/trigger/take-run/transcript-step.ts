import { rm } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@trigger.dev/sdk";
import { eq, and } from "drizzle-orm";
import { whileJobActive } from "@/db/data/jobs";
import { getTranscriptByTake, upsertTranscript } from "@/db/data/transcripts";
import { jobStep } from "@/db/schema";
import { DEEPGRAM_MODEL } from "@/lib/deepgram";
import { parseTranscriptEnv } from "@/lib/env";
import type { FailureCode } from "@/lib/failure-codes";
import type { SkipReason } from "@/lib/processing";
import {
  DeepgramError,
  DeepgramTimeout,
  deepgramFailureCode,
  extractAudioWithFfmpeg,
  postAudioFile,
  postToDeepgram,
} from "../transcript-provider";
import { type RunContext, setStep } from "./context";

/** How the in run `transcript` step ended (spec 0012). Only `failed` starts the separate job. */
export type TranscriptOutcome = "succeeded" | "skipped" | "failed";

/** The outside world of the step, so tests can fake ffmpeg and Deepgram. */
export type TranscriptStepIo = {
  /** The Deepgram key, or null when it is missing (the step then fails `provider_error`). */
  readonly apiKey: () => string | null;
  /** Writes the mono 16 kHz Opus file for the local original to `outPath`. */
  readonly extractAudio: (source: string, outPath: string, signal: AbortSignal) => Promise<void>;
  readonly post: (audio: Uint8Array, apiKey: string, signal: AbortSignal) => Promise<unknown>;
  /** Waits before the one retry. */
  readonly pause: (ms: number) => Promise<void>;
};

export const realTranscriptIo: TranscriptStepIo = {
  apiKey: () => {
    try {
      return parseTranscriptEnv().DEEPGRAM_API_KEY;
    } catch {
      return null;
    }
  },
  extractAudio: (source, outPath, signal) =>
    extractAudioWithFfmpeg(source, outPath, { remote: false, signal }),
  post: (audio, apiKey, signal) => postToDeepgram(audio, apiKey, fetch, signal),
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The job was cancelled or finished under the step: the run stops, the step is not marked failed. */
class RunStopped extends Error {}

/** A retry is worth it for 429, 5xx and network errors, not for the 5 minute fetch timeout. */
function isRetryable(error: unknown): boolean {
  return error instanceof DeepgramError && !(error instanceof DeepgramTimeout);
}

/**
 * The `transcript` step inside a full run (spec 0012, Pipeline step 3). Audio comes from the
 * run's local original (no presigned link, no second probe). `editSignal` is the 120 s edit
 * deadline combined with the run signal: it bounds ffmpeg and Deepgram. The write takes the run
 * signal only, so a write after the edit deadline is not rolled back as `aborted`.
 *
 * Never fails the job: a Deepgram failure, the edit deadline or a missing key ends the step
 * `failed` (`provider_rejected`, `timeout` or `provider_error`) and the caller starts the
 * separate transcribe job after Ready. Only the run's own stop (cancel, job deadline) is
 * rethrown. A take with no sound is skipped `no_speech` here, before anything else. A step the
 * job already ended (attempt 2 of the same job) is reused: Deepgram is not called again.
 * No text, audio, key or link is logged: IDs and counts only.
 */
export async function transcriptStep(
  ctx: RunContext,
  editSignal: AbortSignal,
  io: TranscriptStepIo = realTranscriptIo,
): Promise<TranscriptOutcome> {
  const { client, job, take: t, signal, source, facts } = ctx;

  const audioPath = join(ctx.work, "audio.ogg");
  try {
    if (!facts.hasAudio) {
      await setStep(ctx, "transcript", "skipped", 0, "no_speech");
      return "skipped";
    }

    const reused = await reusedOutcome(ctx);
    if (reused) return reused;

    const apiKey = io.apiKey();
    if (!apiKey) {
      logger.warn("process-take: transcript step has no Deepgram key", { jobId: job.id });
      await setStep(ctx, "transcript", "failed", 0, "provider_error");
      return "failed";
    }

    await setStep(ctx, "transcript", "running", 0);
    await io.extractAudio(source, audioPath, editSignal);
    await setStep(ctx, "transcript", "running", 40);

    const attempt = () =>
      postAudioFile(audioPath, (audio) => io.post(audio, apiKey, editSignal), editSignal);
    let parsed;
    try {
      parsed = await attempt();
    } catch (error) {
      if (!isRetryable(error) || editSignal.aborted) throw error;
      await io.pause(1000);
      parsed = await attempt();
    }

    if (parsed.kind !== "words") {
      await setStep(ctx, "transcript", "skipped", 0, parsed.kind satisfies SkipReason);
      return "skipped";
    }

    signal.throwIfAborted();
    const saved = await whileJobActive(
      client,
      job.id,
      (tx) =>
        upsertTranscript(tx, {
          takeId: t.id,
          language: parsed.language,
          text: parsed.text,
          words: parsed.words,
          sourceFps: facts.fps ?? 30,
          model: DEEPGRAM_MODEL,
        }),
      signal,
    );
    if (!saved.ok) {
      // The job was cancelled or finished (or the run's own deadline fired): the run stops.
      if (saved.error === "job_final" || saved.error === "aborted") {
        signal.throwIfAborted();
        throw new RunStopped(`transcript save refused: ${saved.error}`);
      }
      // The take was deleted meanwhile: nothing to keep.
      await setStep(ctx, "transcript", "failed", 40, "provider_error");
      return "failed";
    }
    await setStep(ctx, "transcript", "succeeded", 100);
    logger.info("process-take: transcript saved", {
      jobId: job.id,
      takeId: t.id,
      words: parsed.words.length,
    });
    return "succeeded";
  } catch (error) {
    // The run itself was stopped (cancel, job deadline): not this step's business.
    if (error instanceof RunStopped) throw error;
    signal.throwIfAborted();
    const code = failureCodeOf(error, editSignal);
    logger.warn("process-take: transcript step failed", { jobId: job.id, takeId: t.id, code });
    // Best effort: a failed status write must not replace the nonfatal outcome.
    await setStep(ctx, "transcript", "failed", 0, code).catch(() => {
      logger.warn("process-take: transcript status write failed", { jobId: job.id, takeId: t.id });
    });
    return "failed";
  } finally {
    await rm(audioPath, { force: true });
  }
}

type StepFailureCode = Extract<FailureCode, "provider_rejected" | "timeout" | "provider_error">;

/** The code a failure ends the step with: Deepgram's own, `timeout` for the edit deadline. */
function failureCodeOf(error: unknown, editSignal: AbortSignal): StepFailureCode {
  const deepgram = deepgramFailureCode(error);
  if (deepgram) return deepgram;
  return editSignal.aborted ? "timeout" : "provider_error";
}

/**
 * Attempt 2 of the same job: when this job already ended the `transcript` step (and a succeeded
 * one still has its row), return that outcome instead of working again.
 */
async function reusedOutcome(ctx: RunContext): Promise<TranscriptOutcome | null> {
  const [step] = await ctx.client
    .select({ status: jobStep.status })
    .from(jobStep)
    .where(and(eq(jobStep.jobId, ctx.job.id), eq(jobStep.name, "transcript")));
  if (!step) return null;
  if (step.status === "skipped" || step.status === "failed") return step.status;
  if (step.status !== "succeeded") return null;
  return (await getTranscriptByTake(ctx.client, ctx.take.id)) ? "succeeded" : null;
}
