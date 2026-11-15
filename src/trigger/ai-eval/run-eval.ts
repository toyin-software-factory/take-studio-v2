import { z } from "zod";
import { CASE_ENTRIES, type CaseEntry } from "../../../tests/cut-quality/cases";
import { AI_EDIT } from "@/lib/ai-edit";
import { type CutScore, combineScores } from "@/lib/cut-quality";
import type { GroupTotals } from "@/lib/ai-eval-record";
import { sentryCheckAllowed } from "@/lib/sentry-check";
import { callClaude } from "../take-run/ai-call";
import { type CaseReport, type CaseSummary, type EvalIo, evalCase, round } from "./eval-case";

export type { CaseReport, CaseSummary, EvalIo };
export { buildCaseSummary, evalCase } from "./eval-case";

/**
 * The `ai-eval` run (spec 0017, AC-10): the real model over every written case, scored with
 * `scoreCuts` (the per case work is in `eval-case.ts`). Everything it reports is a number, a flag
 * or a case ID. It never reports or logs a prompt, a word or a reason, and an error is reduced to
 * a cause name. The run output also carries a per case summary (`CaseSummary`): times, kinds and
 * counts only, so one copy of the dashboard Output shows which spans each case missed.
 */

export const payloadSchema = z.object({ token: z.string().min(1) });

export const realEvalIo = (log: EvalIo["log"], save?: EvalIo["save"]): EvalIo => ({
  call: callClaude,
  now: () => Date.now(),
  log,
  save,
});

export type EvalOutcome =
  | { readonly outcome: "skipped" }
  | { readonly outcome: "no_key" }
  | {
      readonly outcome: "done";
      readonly cases: number;
      readonly summary: readonly CaseSummary[];
      /** Whether the run was kept for /insights (false: no save step, or it failed). */
      readonly saved: boolean;
    };

/** Times and kinds only (`start-end kind`), the same strings as the run output, so the trace shows them. */
function logCase(io: EvalIo, r: CaseReport, summary: CaseSummary): void {
  io.log("ai-eval: case", {
    caseId: r.caseId,
    holdout: r.holdout,
    precision: r.precision,
    recall: r.recall,
    wrongKeeps: r.wrongKeeps,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    seconds: r.seconds,
    fallback: r.fallback ?? "none",
    missed: summary.missed,
    wrongKeepSpans: summary.wrongKeeps,
    cuts: summary.cuts,
  });
}

function logTotal(
  io: EvalIo,
  group: "main" | "holdout" | "all",
  reports: readonly CaseReport[],
  scores: readonly CutScore[],
): GroupTotals {
  const total = combineScores(scores);
  io.log("ai-eval: total", {
    group,
    cases: reports.length,
    precision: round(total.precision),
    recall: round(total.recall),
    wrongKeeps: total.wrongKeeps,
    fallbacks: reports.filter((r) => r.fallback !== null).length,
    inputTokens: reports.reduce((sum, r) => sum + r.inputTokens, 0),
    outputTokens: reports.reduce((sum, r) => sum + r.outputTokens, 0),
    seconds: round(reports.reduce((sum, r) => sum + r.seconds, 0)),
  });
  return {
    cases: reports.length,
    precision: round(total.precision),
    recall: round(total.recall),
    wrongKeeps: total.wrongKeeps,
  };
}

/**
 * The task body. A wrong, empty or missing token, or a missing `AI_EVAL_TOKEN`, returns `skipped`
 * before anything else happens: no key is read and no model call is made. A missing Anthropic key
 * returns `no_key`. The token and the key are never logged or returned.
 */
export async function runAiEval(
  payload: unknown,
  env: {
    readonly AI_EVAL_TOKEN: string | undefined;
    readonly ANTHROPIC_API_KEY: string | undefined;
  },
  io: EvalIo,
  entries: readonly CaseEntry[] = CASE_ENTRIES,
): Promise<EvalOutcome> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || !(await sentryCheckAllowed(parsed.data.token, env.AI_EVAL_TOKEN))) {
    return { outcome: "skipped" };
  }
  if (!env.ANTHROPIC_API_KEY) return { outcome: "no_key" };

  const done: { report: CaseReport; score: CutScore; summary: CaseSummary }[] = [];
  for (const entry of entries) {
    const result = await evalCase(entry, env.ANTHROPIC_API_KEY, io);
    if (!result) {
      io.log("ai-eval: case skipped", { reason: "bad_case" });
      continue;
    }
    logCase(io, result.report, result.summary);
    done.push(result);
  }
  const pick = (holdout: boolean | null) =>
    done.filter((d) => holdout === null || d.report.holdout === holdout);
  const totals = Object.fromEntries(
    (
      [
        ["main", false],
        ["holdout", true],
        ["all", null],
      ] as const
    ).map(([group, holdout]) => {
      const chosen = pick(holdout);
      return [
        group,
        logTotal(
          io,
          group,
          chosen.map((d) => d.report),
          chosen.map((d) => d.score),
        ),
      ];
    }),
  ) as Record<"main" | "holdout" | "all", GroupTotals>;
  const summary = done.map((d) => d.summary);
  let saved = false;
  if (io.save && done.length > 0) {
    try {
      await io.save({ model: AI_EDIT.model, ...totals, summary });
      saved = true;
    } catch {
      // The run output still has everything; only the fact that saving failed is logged.
      io.log("ai-eval: save failed", {});
    }
  }
  return { outcome: "done", cases: done.length, summary, saved };
}
