import type { CaseEntry } from "../../../tests/cut-quality/cases";
import {
  AI_EDIT,
  type AiCause,
  aiEditAnswerSchema,
  buildAiRequest,
  validateAiEdit,
} from "@/lib/ai-edit";
import {
  type CutScore,
  type ScoredCut,
  type ExpectedSpan,
  type SpanRef,
  cutCaseSchema,
  missesOf,
  scoreCuts,
} from "@/lib/cut-quality";
import type { EvalRunInput } from "@/lib/ai-eval-record";
import { type AiCallResult, classifyAiError } from "../take-run/ai-call";

/**
 * One `ai-eval` case (spec 0017, AC-10): the real model on one written case, scored with
 * `scoreCuts`. Numbers, flags and case IDs only (the cases are invented): never a prompt, a word,
 * a reason or error text. Apart from Trigger.dev so tests can fake the model and the clock.
 */

/** The outside world of the run. */
export type EvalIo = {
  readonly call: (
    request: ReturnType<typeof buildAiRequest>,
    apiKey: string,
    signal: AbortSignal,
  ) => Promise<AiCallResult>;
  readonly now: () => number;
  /** One log line: a fixed message and numbers, flags, IDs and span strings (times and kinds) only. */
  readonly log: (
    message: string,
    fields: Readonly<Record<string, string | number | boolean | readonly string[]>>,
  ) => void;
  /** Keeps the finished run for /insights (B2-T72). Optional so tests can leave it out. */
  readonly save?: (run: EvalRunInput) => Promise<void>;
};

/** One case's numbers. `fallback` names why the model's answer was not used (then the rules cuts are scored). */
export type CaseReport = {
  readonly caseId: string;
  readonly holdout: boolean;
  readonly precision: number;
  readonly recall: number;
  readonly wrongKeeps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly seconds: number;
  readonly fallback: AiCause | null;
};

/**
 * One case for the run output (spec 0017 AC-10): the scores, the must cut spans the answer missed
 * and the keep spans it cut (`start-end kind`, in ms), and the cuts it applied (`start-end kind`).
 * Times and kinds only: no word, reason or prompt, and no creator data (the cases are invented).
 */
export type CaseSummary = {
  readonly id: string;
  readonly holdout: boolean;
  readonly precision: number;
  readonly recall: number;
  readonly fallback: AiCause | null;
  readonly missed: readonly string[];
  readonly wrongKeeps: readonly string[];
  readonly cuts: readonly string[];
};

export const round = (n: number): number => Math.round(n * 1000) / 1000;

const spanText = (s: SpanRef): string => `${s.startMs}-${s.endMs} ${s.kind}`;

/** The per case summary for the run output: pure, from the report, the marked spans and the cuts scored. */
export function buildCaseSummary(
  report: Pick<CaseReport, "caseId" | "holdout" | "precision" | "recall" | "fallback">,
  expected: readonly ExpectedSpan[],
  cuts: readonly ScoredCut[],
): CaseSummary {
  const { missed, wrongKeeps } = missesOf(expected, cuts);
  return {
    id: report.caseId,
    holdout: report.holdout,
    precision: report.precision,
    recall: report.recall,
    fallback: report.fallback,
    missed: missed.map(spanText),
    wrongKeeps: wrongKeeps.map(spanText),
    cuts: [...cuts].sort((a, b) => a.startMs - b.startMs).map(spanText),
  };
}

/** One call with the production single retry for 429, 5xx and network errors. */
async function callOnce(
  io: EvalIo,
  request: ReturnType<typeof buildAiRequest>,
  apiKey: string,
  signal: AbortSignal,
): Promise<AiCallResult> {
  try {
    return await io.call(request, apiKey, signal);
  } catch (error) {
    const failure = classifyAiError(error, signal);
    if (!failure.retryable || signal.aborted) throw failure;
    return io.call(request, apiKey, signal);
  }
}

type Answered =
  | { readonly kind: "cuts"; readonly cuts: ScoredCut[] }
  | { readonly kind: "fallback"; readonly cause: AiCause };

/** Parses and validates the model's text exactly as `ai-edit-step` does, to the applied cuts. */
function answerToCuts(
  result: AiCallResult,
  c: ReturnType<typeof cutCaseSchema.parse>,
  candidates: readonly { startMs: number; endMs: number; reason: string }[],
): Answered {
  if (result.stopReason === "max_tokens") return { kind: "fallback", cause: "cutoff" };
  if (result.stopReason === "refusal") return { kind: "fallback", cause: "provider_rejected" };
  if (result.text === null) return { kind: "fallback", cause: "invalid" };
  let json: unknown;
  try {
    json = JSON.parse(result.text);
  } catch {
    return { kind: "fallback", cause: "invalid" };
  }
  const answer = aiEditAnswerSchema.safeParse(json);
  if (!answer.success) return { kind: "fallback", cause: "invalid" };
  const valid = validateAiEdit(
    answer.data,
    c.words,
    candidates,
    c.durationMs,
    [],
    Boolean(c.script),
  );
  if (!valid.ok) return { kind: "fallback", cause: "invalid" };
  return {
    kind: "cuts",
    cuts: valid.data.cuts
      .filter((x) => x.applied)
      .map((x) => ({ startMs: x.startMs, endMs: x.endMs, kind: x.kind })),
  };
}

/**
 * Runs the model on one case and scores it. When the answer cannot be used (call failed, cut off,
 * refused, invalid) the rules cuts are scored, as production would fall back, and `fallback` says why.
 */
export async function evalCase(
  entry: CaseEntry,
  apiKey: string,
  io: EvalIo,
): Promise<{
  readonly report: CaseReport;
  readonly score: CutScore;
  readonly summary: CaseSummary;
} | null> {
  const parsed = cutCaseSchema.safeParse(entry.raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  const candidates = c.pauses.map((p) => ({ ...p, reason: "Pause" }));
  const rules: ScoredCut[] = candidates.map((p) => ({ ...p, kind: "pause" }));
  const request = buildAiRequest({
    words: c.words,
    candidates,
    durationMs: c.durationMs,
    script: c.script,
  });

  const started = io.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let answered: Answered;
  if (request.estimatedInputTokens > AI_EDIT.maxInputTokens) {
    answered = { kind: "fallback", cause: "too_large" };
  } else {
    const signal = AbortSignal.timeout(AI_EDIT.deadlineMs);
    try {
      const result = await callOnce(io, request, apiKey, signal);
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      answered = answerToCuts(result, c, candidates);
    } catch (error) {
      // Only the cause name leaves this block, never the error text.
      answered = { kind: "fallback", cause: classifyAiError(error, signal).cause };
    }
  }
  const seconds = round((io.now() - started) / 1000);
  const scored = answered.kind === "cuts" ? answered.cuts : rules;
  const score = scoreCuts(c.expected, scored);
  const report: CaseReport = {
    caseId: c.id,
    holdout: entry.holdout,
    precision: round(score.precision),
    recall: round(score.recall),
    wrongKeeps: score.wrongKeeps,
    inputTokens,
    outputTokens,
    seconds,
    fallback: answered.kind === "fallback" ? answered.cause : null,
  };
  return { score, report, summary: buildCaseSummary(report, c.expected, scored) };
}
