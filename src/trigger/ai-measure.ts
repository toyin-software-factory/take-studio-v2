import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, task } from "@trigger.dev/sdk";
import {
  AI_EDIT,
  type AiCandidate,
  type CatalogEntry,
  aiEditAnswerSchema,
  buildAiRequest,
  validateAiEdit,
} from "@/lib/ai-edit";
import {
  type AiMeasureClip,
  type AiMeasureFallback,
  type AiMeasureResult,
  aiMeasurePayloadSchema,
  countAiCuts,
  realCatalog,
} from "@/lib/ai-measure";
import { ORIGINAL_INPUT } from "@/lib/ffmpeg-input";
import { EDIT_DEADLINE_MS } from "@/lib/processing";
import { sentryCheckAllowed } from "@/lib/sentry-check";
import { cutsFromSilences, parseSilences, silencedetectFilter } from "@/lib/trim";
import { probeFile, runFfmpeg } from "./media";
import { type AiEditIo, callWithRetry, realAiEditIo } from "./take-run/ai-edit-step";
import { classifyAiError } from "./take-run/ai-call";
import { type TranscriptStepIo, realTranscriptIo } from "./take-run/transcript-step";
import { DeepgramError, DeepgramTimeout, postAudioFile } from "./transcript-provider";

/**
 * TEMPORARY (B-T18, C-15): times the transcript and AI edit steps from Trigger.dev cloud for
 * AC-6 of spec 0012, because the sandbox proxy blocks real Anthropic calls. Removed with
 * `ai-key-check` after C-15. Manual only (the app never triggers it) and token gated exactly like
 * `ai-key-check`: it acts only when the payload token equals SENTRY_CHECK_TOKEN (constant time).
 *
 * The clip is built here from the committed `speech-en` fixture (bundled by trigger.config.ts):
 * "speech" is the fixture itself, "ten-min" is its audio looped to 10 minutes. No creator data,
 * no database rows, no R2. It composes the same functions, keys, constants and retry as the real
 * run, in the same order, under one 120 s deadline that starts with the transcript: extract audio,
 * Deepgram (one retry), the rules pause candidates, the request, Claude (`callWithRetry`), the
 * answer check. The database writes of the two real steps are left out (local SQL, not what
 * AC-6 limits). It returns and logs numbers only: never a word, a cut text, a prompt or a key.
 */
const FIXTURE = join("tests", "fixtures", "media", "speech-en.mp4");
const TEN_MIN_SECONDS = 600;

export type AiMeasureIo = {
  /** Gives the local clip file (and builds the 10 minute one); `cleanup` removes what it made. */
  readonly prepareClip: (
    clip: AiMeasureClip,
  ) => Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }>;
  readonly durationMs: (path: string) => Promise<number | null>;
  readonly candidates: (path: string, durationMs: number) => Promise<readonly AiCandidate[]>;
  readonly transcript: TranscriptStepIo;
  readonly ai: AiEditIo;
  readonly catalog: readonly CatalogEntry[];
  readonly now: () => number;
};

export const realAiMeasureIo: AiMeasureIo = {
  prepareClip: async (clip) => {
    const source = join(process.cwd(), FIXTURE);
    if (clip === "speech") return { path: source, cleanup: async () => {} };
    const dir = await mkdtemp(join(tmpdir(), "ai-measure-"));
    const path = join(dir, "ten-min.m4a");
    await runFfmpeg(
      [
        "-y",
        "-stream_loop",
        "-1",
        ...ORIGINAL_INPUT,
        "-i",
        source,
        "-vn",
        "-t",
        String(TEN_MIN_SECONDS),
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        path,
      ],
      { timeoutMs: 5 * 60_000 },
    );
    return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
  },
  durationMs: async (path) => (await probeFile(path))?.durationMs ?? null,
  candidates: async (path, durationMs) => {
    const stderr = await runFfmpeg(
      [...ORIGINAL_INPUT, "-i", path, "-vn", "-af", silencedetectFilter(), "-f", "null", "-"],
      { timeoutMs: 5 * 60_000 },
    );
    return cutsFromSilences(parseSilences(stderr, durationMs), durationMs);
  },
  transcript: realTranscriptIo,
  ai: realAiEditIo,
  catalog: realCatalog(),
  now: Date.now,
};

type Timed =
  | { readonly kind: "words"; readonly words: readonly Words[]; readonly endedAt: number }
  | { readonly kind: "none"; readonly fallback: AiMeasureFallback; readonly endedAt: number };
type Words = Parameters<typeof buildAiRequest>[0]["words"][number];

/** The transcript step without its database writes: extract, post, one retry as the step does. */
async function timedTranscript(
  io: AiMeasureIo,
  path: string,
  dir: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Timed> {
  const audio = join(dir, "audio.ogg");
  try {
    await io.transcript.extractAudio(path, audio, signal);
    const attempt = () =>
      postAudioFile(audio, (bytes) => io.transcript.post(bytes, apiKey, signal), signal);
    let parsed;
    try {
      parsed = await attempt();
    } catch (error) {
      const retryable = error instanceof DeepgramError && !(error instanceof DeepgramTimeout);
      if (!retryable || signal.aborted) throw error;
      await io.transcript.pause(1000);
      parsed = await attempt();
    }
    if (parsed.kind !== "words") {
      return { kind: "none", fallback: "transcript_skipped", endedAt: io.now() };
    }
    return { kind: "words", words: parsed.words, endedAt: io.now() };
  } catch {
    return { kind: "none", fallback: "transcript_failed", endedAt: io.now() };
  } finally {
    await rm(audio, { force: true });
  }
}

function parseAnswer(text: string | null) {
  if (text === null) return null;
  try {
    const parsed = aiEditAnswerSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The measurement itself, apart from Trigger.dev. */
export async function runAiMeasure(
  payload: unknown,
  expectedToken: string | undefined,
  io: AiMeasureIo,
): Promise<AiMeasureResult> {
  const parsed = aiMeasurePayloadSchema.safeParse(payload);
  if (!parsed.success || !(await sentryCheckAllowed(parsed.data.token, expectedToken))) {
    return { outcome: "skipped" };
  }
  const { clip } = parsed.data;
  const deepgramKey = io.transcript.apiKey();
  if (!deepgramKey) return { outcome: "no_key", missing: "deepgram" };
  const anthropicKey = io.ai.apiKey();
  if (!anthropicKey) return { outcome: "no_key", missing: "anthropic" };

  const prepared = await io.prepareClip(clip);
  const dir = await mkdtemp(join(tmpdir(), "ai-measure-run-"));
  try {
    const clipMs = await io.durationMs(prepared.path);
    if (clipMs === null) throw new Error("clip not readable");
    // The rules candidates come from the trim step, which is before the measured window.
    const candidates = await io.candidates(prepared.path, clipMs);

    // The window starts with the transcript and covers the AI edit, like the real run.
    const startedAt = io.now();
    const signal = AbortSignal.timeout(EDIT_DEADLINE_MS);
    const transcript = await timedTranscript(io, prepared.path, dir, deepgramKey, signal);
    const transcriptMs = transcript.endedAt - startedAt;
    const base = {
      outcome: "measured",
      clip,
      clipMs,
      candidates: candidates.length,
      transcriptMs,
      deadlineMs: EDIT_DEADLINE_MS,
      catalogEntries: io.catalog.length,
    } as const;
    const finish = (r: {
      readonly endedAt: number;
      readonly words: number;
      readonly estimatedInputTokens: number | null;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly aiCuts: number | null;
      readonly aiCutsApplied: number | null;
      readonly fallback: AiMeasureFallback | null;
    }): AiMeasureResult => {
      const totalMs = r.endedAt - startedAt;
      return {
        ...base,
        words: r.words,
        aiEditMs: r.endedAt - transcript.endedAt,
        totalMs,
        withinDeadline: totalMs <= EDIT_DEADLINE_MS && !signal.aborted,
        estimatedInputTokens: r.estimatedInputTokens,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        aiCuts: r.aiCuts,
        aiCutsApplied: r.aiCutsApplied,
        fallback: r.fallback,
      };
    };
    const none = (fallback: AiMeasureFallback, words: number, estimate: number | null = null) =>
      finish({
        endedAt: io.now(),
        words,
        estimatedInputTokens: estimate,
        inputTokens: null,
        outputTokens: null,
        aiCuts: null,
        aiCutsApplied: null,
        fallback,
      });

    if (transcript.kind === "none") {
      return finish({
        endedAt: transcript.endedAt,
        words: 0,
        estimatedInputTokens: null,
        inputTokens: null,
        outputTokens: null,
        aiCuts: null,
        aiCutsApplied: null,
        fallback: transcript.fallback,
      });
    }

    const { words } = transcript;
    const request = buildAiRequest({ words, candidates, durationMs: clipMs, catalog: io.catalog });
    if (request.estimatedInputTokens > AI_EDIT.maxInputTokens) {
      return none("too_large", words.length, request.estimatedInputTokens);
    }
    let result;
    try {
      result = await callWithRetry(request, anthropicKey, signal, io.ai);
    } catch (error) {
      return none(classifyAiError(error, signal).cause, words.length, request.estimatedInputTokens);
    }
    const base2 = { estimatedInputTokens: request.estimatedInputTokens, words: words.length };
    const fail = (fallback: AiMeasureFallback) =>
      finish({
        endedAt: io.now(),
        ...base2,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        aiCuts: null,
        aiCutsApplied: null,
        fallback,
      });
    if (result.stopReason === "max_tokens") return fail("cutoff");
    if (result.stopReason === "refusal") return fail("provider_rejected");
    const answer = parseAnswer(result.text);
    if (!answer) return fail("invalid");
    const checked = validateAiEdit(answer, words, candidates, clipMs, io.catalog);
    if (!checked.ok) return fail("invalid");
    return finish({
      endedAt: io.now(),
      ...base2,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ...countAiCuts(checked.data.cuts),
      fallback: null,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
    await prepared.cleanup();
  }
}

export const aiMeasureTask = task({
  id: "ai-measure",
  machine: "large-1x",
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async (payload: unknown) => {
    const result = await runAiMeasure(payload, process.env.SENTRY_CHECK_TOKEN, realAiMeasureIo);
    logger.info("ai-measure", result);
    return result;
  },
});
