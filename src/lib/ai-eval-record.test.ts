import { describe, expect, it } from "vitest";
import {
  EVAL_RUNS_KEPT,
  type EvalRunInput,
  casesByTrouble,
  checkFloors,
  storedCasesSchema,
  toRunRow,
} from "./ai-eval-record";

const totals = (precision: number, recall: number, cases = 2, wrongKeeps = 1) => ({
  cases,
  precision,
  recall,
  wrongKeeps,
});
const run: EvalRunInput = {
  model: "claude-test",
  main: totals(0.9, 0.8, 1, 0),
  holdout: totals(0.7, 0.6, 1, 1),
  all: totals(0.8, 0.7),
  summary: [
    {
      id: "a",
      holdout: false,
      precision: 0.9,
      recall: 0.8,
      fallback: null,
      missed: ["100-200 filler"],
      wrongKeeps: [],
      cuts: ["100-200 filler", "300-400 pause"],
    },
    {
      id: "b",
      holdout: true,
      precision: 0.7,
      recall: 0.6,
      fallback: "invalid",
      missed: [],
      wrongKeeps: ["5-9 pause"],
      cuts: [],
    },
  ],
};

describe("toRunRow (B2-T72)", () => {
  it("maps the totals to columns and turns each cut list into a count", () => {
    const row = toRunRow(run);
    expect(row).toMatchObject({
      model: "claude-test",
      cases: 2,
      overallPrecision: 0.8,
      overallRecall: 0.7,
      mainPrecision: 0.9,
      mainRecall: 0.8,
      holdoutPrecision: 0.7,
      holdoutRecall: 0.6,
      wrongKeeps: 1,
    });
    expect(row.summary.map((c) => c.cuts)).toEqual([2, 0]);
    expect(row.summary[0]?.missed).toEqual(["100-200 filler"]);
    expect(storedCasesSchema.safeParse(row.summary).success).toBe(true);
  });

  it("stores no field beyond ids, scores, kinds with times and counts", () => {
    const keys = Object.keys(toRunRow(run).summary[0] ?? {}).sort();
    expect(keys).toEqual(
      ["cuts", "fallback", "holdout", "id", "missed", "precision", "recall", "wrongKeeps"].sort(),
    );
  });
});

describe("casesByTrouble", () => {
  it("puts the cases with misses or wrong keeps first, then the rest by id", () => {
    const base = { holdout: false, precision: 1, recall: 1, fallback: null, cuts: 0 };
    const ordered = casesByTrouble([
      { ...base, id: "clean-b", missed: [], wrongKeeps: [] },
      { ...base, id: "one", missed: ["1-2 pause"], wrongKeeps: [] },
      { ...base, id: "clean-a", missed: [], wrongKeeps: [] },
      { ...base, id: "two", missed: ["1-2 pause"], wrongKeeps: ["3-4 filler"] },
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["two", "one", "clean-a", "clean-b"]);
  });
});

describe("checkFloors", () => {
  const baseline = {
    all: { precision: 0.8, recall: 0.7 },
    holdout: { precision: 0.7, recall: 0.6 },
  };
  it("is ok at the floors and not below them", () => {
    expect(checkFloors(toRunRow(run), baseline).map((f) => f.ok)).toEqual([true, true]);
    const low = { ...toRunRow(run), holdoutRecall: 0.59 };
    expect(checkFloors(low, baseline).map((f) => f.ok)).toEqual([true, false]);
  });
});

describe("EVAL_RUNS_KEPT", () => {
  it("keeps the last 50 runs", () => {
    expect(EVAL_RUNS_KEPT).toBe(50);
  });
});
