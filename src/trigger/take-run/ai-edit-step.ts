import { logger } from "@trigger.dev/sdk";
import { listBuiltInCatalog } from "@/db/data/backgrounds";
import { whileJobActive } from "@/db/data/jobs";
import { getTranscriptByTake } from "@/db/data/transcripts";
import {
  AI_EDIT,
  type AiCandidate,
  type AiCause,
  type CatalogEntry,
  type ValidAiEdit,
  aiEditAnswerSchema,
  buildAiRequest,
  validateAiEdit,
} from "@/lib/ai-edit";
import { parseAiEditEnv } from "@/lib/env";
import { type AiCallResult, callClaude, classifyAiError } from "./ai-call";
import { reportAiUnavailable } from "./ai-unavailable";
import type { RunContext } from "./context";
import {
  RunStopped,
  aiEditAlreadyFinal,
  setFinal,
  setStepRunning,
  transcriptSkipReason,
  writeValid,
} from "./ai-edit-store";
import type { TranscriptOutcome } from "./transcript-step";

export { aiEditAlreadyFinal, storedHasCuts } from "./ai-edit-store";

/** The outside world of the step, so tests can fake Claude. */
export type AiEditIo = {
  /** The Anthropic key, or null when it is missing (the step then falls back `no_key`). */
  readonly apiKey: () => string | null;
  readonly call: (
    request: ReturnType<typeof buildAiRequest>,
    apiKey: string,
    signal: AbortSignal,
  ) => Promise<AiCallResult>;
  /** Waits before the one retry. */
  readonly pause: (ms: number) => Promise<void>;
  readonly report: typeof reportAiUnavailable;
};

export const realAiEditIo: AiEditIo = {
  apiKey: () => {
    try {
      return parseAiEditEnv().ANTHROPIC_API_KEY;
    } catch {
      return null;
    }
  },
  call: callClaude,
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  report: reportAiUnavailable,
};

/** `hasCuts` is the take's applied cuts after the step; null when the step wrote none. */
export type AiEditOutcome = {
  readonly status: "succeeded" | "skipped";
  readonly hasCuts: boolean | null;
};

type Attempt =
  | { readonly kind: "valid"; readonly edit: ValidAiEdit }
  | { readonly kind: "fallback"; readonly cause: AiCause };

/**
 * The `ai_edit` step (spec 0012, Pipeline steps 2, 4 and 5). One structured Claude call over the
 * stored transcript and the rules pause candidates, validated by `validateAiEdit`. It never fails
 * the job: any problem falls back to the rules cuts already stored by the trim step, ends the step
 * `skipped ai_unavailable` and sends one Sentry message with IDs and a cause. A step this job
 * already ended is reused (no second Claude call). Not English and no speech skip with their own
 * reason and no message. Nothing from the prompt, the answer or a reason is logged.
 */
export async function aiEditStep(
  ctx: RunContext,
  editSignal: AbortSignal,
  input: {
    readonly transcript: TranscriptOutcome;
    readonly candidates: readonly AiCandidate[];
  },
  io: AiEditIo = realAiEditIo,
): Promise<AiEditOutcome> {
  const { job, take: t, signal } = ctx;

  if (await aiEditAlreadyFinal(ctx)) return { status: "skipped", hasCuts: null };

  if (input.transcript === "skipped") {
    await setFinal(ctx, await transcriptSkipReason(ctx));
    return { status: "skipped", hasCuts: null };
  }

  const attempt: Attempt =
    input.transcript === "failed"
      ? { kind: "fallback", cause: "transcript_failed" }
      : await tryAi(ctx, editSignal, input.candidates, io);

  signal.throwIfAborted();
  if (attempt.kind === "valid") {
    const wrote = await whileJobActive(
      ctx.client,
      job.id,
      (tx) => writeValid(tx, ctx, attempt.edit),
      signal,
    );
    if (wrote.ok) {
      logger.info("process-take: ai edit stored", {
        jobId: job.id,
        takeId: t.id,
        cuts: attempt.edit.cuts.length,
        fixes: attempt.edit.fixes.length,
        dropped: attempt.edit.dropped,
      });
      return { status: "succeeded", hasCuts: wrote.data };
    }
    if (wrote.error === "job_final" || wrote.error === "aborted") {
      signal.throwIfAborted();
      throw new RunStopped(`ai edit write refused: ${wrote.error}`);
    }
    return fallback(ctx, "invalid", io);
  }
  return fallback(ctx, attempt.cause, io);
}

async function fallback(ctx: RunContext, cause: AiCause, io: AiEditIo): Promise<AiEditOutcome> {
  await setFinal(ctx, "ai_unavailable");
  logger.warn("process-take: ai edit unavailable", {
    jobId: ctx.job.id,
    takeId: ctx.take.id,
    cause,
  });
  await io.report({ takeId: ctx.take.id, jobId: ctx.job.id, cause });
  return { status: "skipped", hasCuts: null };
}

/** Builds the request, calls Claude (one retry), parses and validates. Never throws but RunStopped. */
async function tryAi(
  ctx: RunContext,
  editSignal: AbortSignal,
  candidates: readonly AiCandidate[],
  io: AiEditIo,
): Promise<Attempt> {
  const apiKey = io.apiKey();
  if (!apiKey) return { kind: "fallback", cause: "no_key" };

  const stored = await getTranscriptByTake(ctx.client, ctx.take.id);
  if (!stored) return { kind: "fallback", cause: "transcript_failed" };
  const words = stored.words;
  const durationMs = ctx.facts.durationMs;

  const catalog: readonly CatalogEntry[] = await listBuiltInCatalog(ctx.client);
  const request = buildAiRequest({
    words,
    candidates,
    durationMs,
    catalog,
    script: ctx.take.script,
  });
  if (request.estimatedInputTokens > AI_EDIT.maxInputTokens) {
    return { kind: "fallback", cause: "too_large" };
  }

  await setStepRunning(ctx);
  let result: AiCallResult;
  try {
    result = await callWithRetry(request, apiKey, editSignal, io);
  } catch (error) {
    ctx.signal.throwIfAborted();
    return { kind: "fallback", cause: classifyAiError(error, editSignal).cause };
  }
  logger.info("process-take: ai edit answered", {
    jobId: ctx.job.id,
    takeId: ctx.take.id,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  if (result.stopReason === "max_tokens") return { kind: "fallback", cause: "cutoff" };
  if (result.stopReason === "refusal") return { kind: "fallback", cause: "provider_rejected" };
  const parsed = parseAnswer(result.text);
  if (!parsed) return { kind: "fallback", cause: "invalid" };
  const checked = validateAiEdit(
    parsed,
    words,
    candidates,
    durationMs,
    catalog,
    Boolean(ctx.take.script?.trim()),
  );
  return checked.ok
    ? { kind: "valid", edit: checked.data }
    : { kind: "fallback", cause: "invalid" };
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

/** One retry for 429, 5xx and network errors, only while the deadline allows. */
export async function callWithRetry(
  request: ReturnType<typeof buildAiRequest>,
  apiKey: string,
  signal: AbortSignal,
  io: AiEditIo,
): Promise<AiCallResult> {
  try {
    return await io.call(request, apiKey, signal);
  } catch (error) {
    const failure = classifyAiError(error, signal);
    if (!failure.retryable || signal.aborted) throw failure;
    await io.pause(1000);
    return io.call(request, apiKey, signal);
  }
}
