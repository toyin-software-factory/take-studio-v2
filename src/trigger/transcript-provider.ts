import { readFile } from "node:fs/promises";
import { AbortTaskRunError } from "@trigger.dev/sdk";
import { ORIGINAL_INPUT } from "@/lib/ffmpeg-input";
import { deepgramUrl, parseDeepgramResponse } from "@/lib/deepgram";
import type { FailureCode } from "@/lib/failure-codes";
import { JOB_ERROR_NAMES, hasJobErrorName } from "@/lib/job-errors";
import { runFfmpeg } from "./media";

/**
 * The Deepgram half of a transcript (spec 0007, spec 0012 task 1), shared by the separate
 * `transcribe-take` job (audio from a presigned link) and the `transcript` step inside
 * `process-take` (audio from the run's local original). No text, audio, key or link is logged.
 */

/** Deepgram answered 5xx or 429, or the network failed: retried. Message holds no content. */
export class DeepgramError extends Error {
  override name: string = JOB_ERROR_NAMES.deepgramError;
  constructor(readonly status: number | null) {
    super(`Deepgram request failed (${status ?? "network"})`);
  }
}

/** The request outlived its 5 minute limit: retried, and `timeout` if it is the last attempt. */
export class DeepgramTimeout extends DeepgramError {
  override name = JOB_ERROR_NAMES.deepgramTimeout;
  constructor() {
    super(null);
  }
}

/** Deepgram refused the request (400, 402, 413, ...): not retried, one Sentry alert. */
export class DeepgramRejected extends AbortTaskRunError {
  constructor(readonly status: number) {
    super(`Deepgram rejected the request (${status})`);
    this.name = JOB_ERROR_NAMES.deepgramRejected;
  }
}

/** The codes a Deepgram error maps to; null for any other error. By name too (plain copies). */
export function deepgramFailureCode(
  error: unknown,
): Extract<FailureCode, "provider_rejected" | "timeout" | "provider_error"> | null {
  if (
    error instanceof DeepgramRejected ||
    hasJobErrorName(error, JOB_ERROR_NAMES.deepgramRejected)
  ) {
    return "provider_rejected";
  }
  if (error instanceof DeepgramTimeout || hasJobErrorName(error, JOB_ERROR_NAMES.deepgramTimeout)) {
    return "timeout";
  }
  if (error instanceof DeepgramError || hasJobErrorName(error, JOB_ERROR_NAMES.deepgramError)) {
    return "provider_error";
  }
  return null;
}

/** True for statuses worth another attempt. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** POSTs the audio to Deepgram; returns the parsed JSON body. Throws the errors above. */
export async function postToDeepgram(
  audio: Uint8Array,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(deepgramUrl(), {
      method: "POST",
      headers: { authorization: `Token ${apiKey}`, "content-type": "audio/ogg" },
      body: audio as BodyInit,
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(5 * 60_000), signal])
        : AbortSignal.timeout(5 * 60_000),
    });
  } catch (error) {
    // Stopped by the job deadline: not a Deepgram failure.
    if (signal?.aborted) throw signal.reason;
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

/**
 * Writes the mono 16 kHz Opus in Ogg file for `input` to `outPath`. `input` is a presigned link
 * (`remote`, with the reconnect options) or a local file.
 */
export async function extractAudioWithFfmpeg(
  input: string,
  outPath: string,
  options: { readonly remote: boolean; readonly signal?: AbortSignal },
): Promise<void> {
  await runFfmpeg(
    [
      "-y",
      ...(options.remote
        ? ["-reconnect", "1", "-reconnect_streamed", "1", "-rw_timeout", "30000000"]
        : []),
      ...ORIGINAL_INPUT,
      "-i",
      input,
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
    { timeoutMs: 10 * 60_000, signal: options.signal },
  );
}

/** What Deepgram's answer parsed to (words, or a skip reason); `invalid` is thrown instead. */
export type TranscribedAudio = Exclude<ReturnType<typeof parseDeepgramResponse>, { kind: "invalid" }>;

/** Reads the audio file, posts it and checks the answer. An unusable answer is a retryable error. */
export async function postAudioFile(
  audioPath: string,
  post: (audio: Uint8Array, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<TranscribedAudio> {
  const body = await post(new Uint8Array(await readFile(audioPath)), signal);
  const parsed = parseDeepgramResponse(body);
  if (parsed.kind === "invalid") throw new DeepgramError(200);
  return parsed;
}
