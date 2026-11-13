import { logger } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { reanalyse } from "@/db/data/cuts";
import { updateStep, whileJobActive } from "@/db/data/jobs";
import { getTranscriptByTake, setTranscriptEdits } from "@/db/data/transcripts";
import { cut, jobStep } from "@/db/schema";
import type { Tx } from "@/db/types";
import {
  AI_EDIT,
  type AiCandidate,
  type AiCause,
  type ValidAiEdit,
  aiEditAnswerSchema,
  buildAiRequest,
  validateAiEdit,
} from "@/lib/ai-edit";
import { parseAiEditEnv } from "@/lib/env";
import { type Result, err, ok } from "@/lib/result";
import { type AiCallResult, callClaude, classifyAiError } from "./ai-call";
import { reportAiUnavailable } from "./ai-unavailable";
import type { RunContext } from "./context";
import type { TranscriptOutcome } from "./transcript-step";

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

/** The job was cancelled or finished under the step: the run stops, the step is not touched. */
class RunStopped extends Error {}

/** True when this job already ended its `ai_edit` step (attempt 2): its results are committed. */
export async function aiEditAlreadyFinal(ctx: RunContext): Promise<boolean> {
  const [step] = await ctx.client
    .select({ status: jobStep.status })
    .from(jobStep)
    .where(and(eq(jobStep.jobId, ctx.job.id), eq(jobStep.name, "ai_edit")));
  return step?.status === "succeeded" || step?.status === "skipped";
}

/** Whether the take has any applied cut right now. */
export async function storedHasCuts(ctx: RunContext): Promise<boolean> {
  const rows = await ctx.client
    .select({ id: cut.id })
    .from(cut)
    .where(and(eq(cut.takeId, ctx.take.id), eq(cut.applied, true)))
    .limit(1);
  return rows.length > 0;
}

/** The skip reason the in run transcript step ended with, when it was skipped. */
async function transcriptSkipReason(ctx: RunContext): Promise<"not_english" | "no_speech"> {
  const [step] = await ctx.client
    .select({ failureCode: jobStep.failureCode })
    .from(jobStep)
    .where(and(eq(jobStep.jobId, ctx.job.id), eq(jobStep.name, "transcript")));
  return step?.failureCode === "not_english" ? "not_english" : "no_speech";
}

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

/**
 * Final `skipped` status in a guarded transaction. The fixes are cleared here on fallback; the
 * suggestion columns will be too (spec 0012 part 6): this is the seam.
 */
async function setFinal(
  ctx: RunContext,
  reason: "ai_unavailable" | "not_english" | "no_speech",
): Promise<void> {
  const done = await whileJobActive(
    ctx.client,
    ctx.job.id,
    async (tx) => {
      await setTranscriptEdits(tx, ctx.take.id, []);
      const step = await updateStep(tx, {
        jobId: ctx.job.id,
        name: "ai_edit",
        status: "skipped",
        progress: 0,
        failureCode: reason,
      });
      return step.ok ? ok(true) : err("invalid" as const);
    },
    ctx.signal,
  );
  if (!done.ok && (done.error === "job_final" || done.error === "aborted")) {
    ctx.signal.throwIfAborted();
    throw new RunStopped(`ai edit status write refused: ${done.error}`);
  }
}

/** Cuts, the seam for fixes and suggestion, and the final status, in one transaction. */
async function writeValid(
  tx: Tx,
  ctx: RunContext,
  edit: ValidAiEdit,
): Promise<Result<boolean, "invalid">> {
  const analysed = await reanalyse(tx, { takeId: ctx.take.id, proposed: edit.cuts });
  if (!analysed.ok) return err("invalid");
  await setTranscriptEdits(
    tx,
    ctx.take.id,
    edit.fixes.map((fix) => ({ ...fix, undone: false })),
  );
  // Seam (part 6): the suggestion columns are written here, from `edit.background`, in this
  // same transaction.
  const step = await updateStep(tx, {
    jobId: ctx.job.id,
    name: "ai_edit",
    status: "succeeded",
    progress: 100,
  });
  if (!step.ok) return err("invalid");
  return ok(analysed.data.cuts.some((c) => c.applied));
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

  const request = buildAiRequest({ words, candidates, durationMs });
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
  const checked = validateAiEdit(parsed, words, candidates, durationMs);
  return checked.ok
    ? { kind: "valid", edit: checked.data }
    : { kind: "fallback", cause: "invalid" };
}

async function setStepRunning(ctx: RunContext): Promise<void> {
  await updateStep(ctx.client, {
    jobId: ctx.job.id,
    name: "ai_edit",
    status: "running",
    progress: 0,
  });
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
async function callWithRetry(
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
