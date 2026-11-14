import { z } from "zod";

/**
 * What `ai-eval` keeps of a run (B2-T72, spec 0017 follow-up): numbers, case ids and cut kinds
 * with times. The cases are invented, so their ids are safe. Never a word, a prompt, a link or
 * a video. Pure: the mapping, the baseline comparison and the ordering for the page.
 */

/** Runs kept in the table; older ones are deleted when a new one is saved. */
export const EVAL_RUNS_KEPT = 50;

/** One case as stored: `missed` and `wrongKeeps` are `start-end kind` strings, `cuts` a count. */
export const storedCaseSchema = z.object({
  id: z.string(),
  holdout: z.boolean(),
  precision: z.number(),
  recall: z.number(),
  fallback: z.string().nullable(),
  missed: z.array(z.string()),
  wrongKeeps: z.array(z.string()),
  cuts: z.number().int().nonnegative(),
});
export type StoredCase = z.infer<typeof storedCaseSchema>;
export const storedCasesSchema = z.array(storedCaseSchema);

export type GroupTotals = {
  readonly cases: number;
  readonly precision: number;
  readonly recall: number;
  readonly wrongKeeps: number;
};

/** The run as `ai-eval` hands it over (the per case summary lists its cuts in full). */
export type EvalRunInput = {
  readonly model: string;
  readonly main: GroupTotals;
  readonly holdout: GroupTotals;
  readonly all: GroupTotals;
  readonly summary: readonly {
    readonly id: string;
    readonly holdout: boolean;
    readonly precision: number;
    readonly recall: number;
    readonly fallback: string | null;
    readonly missed: readonly string[];
    readonly wrongKeeps: readonly string[];
    readonly cuts: readonly string[];
  }[];
};

/** The columns of one `ai_eval_run` row (the time is set by the database). */
export type EvalRunRow = {
  readonly model: string;
  readonly cases: number;
  readonly overallPrecision: number;
  readonly overallRecall: number;
  readonly mainPrecision: number;
  readonly mainRecall: number;
  readonly holdoutPrecision: number;
  readonly holdoutRecall: number;
  readonly wrongKeeps: number;
  readonly summary: readonly StoredCase[];
};

/** Summary to row: the cut list becomes a count, everything else is copied as is. */
export function toRunRow(run: EvalRunInput): EvalRunRow {
  return {
    model: run.model,
    cases: run.all.cases,
    overallPrecision: run.all.precision,
    overallRecall: run.all.recall,
    mainPrecision: run.main.precision,
    mainRecall: run.main.recall,
    holdoutPrecision: run.holdout.precision,
    holdoutRecall: run.holdout.recall,
    wrongKeeps: run.all.wrongKeeps,
    summary: run.summary.map((c) => ({
      id: c.id,
      holdout: c.holdout,
      precision: c.precision,
      recall: c.recall,
      fallback: c.fallback,
      missed: [...c.missed],
      wrongKeeps: [...c.wrongKeeps],
      cuts: c.cuts.length,
    })),
  };
}

/** Cases with a miss or a wrong keep first (most first), then the rest by id. */
export function casesByTrouble(cases: readonly StoredCase[]): StoredCase[] {
  const trouble = (c: StoredCase) => c.missed.length + c.wrongKeeps.length;
  return [...cases].sort((a, b) => trouble(b) - trouble(a) || a.id.localeCompare(b.id));
}

export type Baseline = {
  readonly all: { readonly precision: number; readonly recall: number };
  readonly holdout: { readonly precision: number; readonly recall: number };
};

export type FloorCheck = {
  readonly group: "all" | "holdout";
  readonly precision: number;
  readonly recall: number;
  readonly precisionFloor: number;
  readonly recallFloor: number;
  /** Both numbers at or above their floors. */
  readonly ok: boolean;
};

/** The run's overall and held out scores against the `baseline.json` floors. */
export function checkFloors(
  run: Pick<
    EvalRunRow,
    "overallPrecision" | "overallRecall" | "holdoutPrecision" | "holdoutRecall"
  >,
  baseline: Baseline,
): FloorCheck[] {
  const one = (
    group: "all" | "holdout",
    precision: number,
    recall: number,
    floor: Baseline["all"],
  ): FloorCheck => ({
    group,
    precision,
    recall,
    precisionFloor: floor.precision,
    recallFloor: floor.recall,
    ok: precision >= floor.precision && recall >= floor.recall,
  });
  return [
    one("all", run.overallPrecision, run.overallRecall, baseline.all),
    one("holdout", run.holdoutPrecision, run.holdoutRecall, baseline.holdout),
  ];
}
