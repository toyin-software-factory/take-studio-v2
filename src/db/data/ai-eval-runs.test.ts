import { afterAll, describe, expect, it } from "vitest";
import { aiEvalRun } from "@/db/schema";
import { openTestDb } from "@/db/testing/test-db";
import { toRunRow } from "@/lib/ai-eval-record";
import { listEvalRuns, saveEvalRun } from "./ai-eval-runs";

// Its own database: the trim looks at the whole table.
const test = await openTestDb({ database: "take_studio_test_ai_eval_runs" });
const { db } = test;
afterAll(async () => {
  await test.close();
});

const row = (precision: number) =>
  toRunRow({
    model: "m",
    main: { cases: 1, precision, recall: 1, wrongKeeps: 0 },
    holdout: { cases: 1, precision, recall: 1, wrongKeeps: 0 },
    all: { cases: 2, precision, recall: 1, wrongKeeps: 0 },
    summary: [],
  });

describe("saveEvalRun (B2-T72)", () => {
  it("keeps only the newest runs", async () => {
    await db.delete(aiEvalRun);
    for (let i = 1; i <= 5; i++) await saveEvalRun(db, row(i / 10), 3);
    const kept = await listEvalRuns(db, 10);
    expect(kept.map((r) => r.overallPrecision)).toEqual([0.5, 0.4, 0.3]);
  });

  it("returns the newest first and honours the limit", async () => {
    const latest = await listEvalRuns(db, 2);
    expect(latest.map((r) => r.overallPrecision)).toEqual([0.5, 0.4]);
  });
});
