import { describe, expect, it, vi } from "vitest";
import { CASE_ENTRIES } from "../../../tests/cut-quality/cases";
import { buildCaseSummary, runAiEval } from "./run-eval";
import {
  TOKEN,
  KEY,
  ENV,
  harness,
  emptyAnswer,
  answerFor,
  secretsOfCases,
} from "./run-eval.support";

describe("buildCaseSummary (spec 0017 AC-10, the run output)", () => {
  const report = { caseId: "c1", holdout: true, precision: 0.5, recall: 0.25, fallback: null };
  const expected = [
    { startMs: 1000, endMs: 2000, verdict: "cut", kind: "filler" },
    { startMs: 3000, endMs: 4000, verdict: "cut", kind: "pause" },
    { startMs: 5000, endMs: 6000, verdict: "keep", kind: "filler" },
  ] as const;

  it("names the missed must cut spans and the wrongly cut keep spans by time and kind", () => {
    const cuts = [
      { startMs: 1000, endMs: 2000, kind: "filler" },
      { startMs: 5000, endMs: 5900, kind: "filler" },
    ] as const;
    expect(buildCaseSummary(report, expected, cuts)).toEqual({
      id: "c1",
      holdout: true,
      precision: 0.5,
      recall: 0.25,
      fallback: null,
      missed: ["3000-4000 pause"],
      wrongKeeps: ["5000-6000 filler"],
      cuts: ["1000-2000 filler", "5000-5900 filler"],
    });
  });

  it("counts a span as hit at 60% like the scorer, and lists cuts in time order", () => {
    const cuts = [
      { startMs: 3000, endMs: 3600, kind: "pause" },
      { startMs: 1000, endMs: 1500, kind: "filler" },
    ] as const;
    const summary = buildCaseSummary(report, expected, cuts);
    expect(summary.missed).toEqual(["1000-2000 filler"]);
    expect(summary.wrongKeeps).toEqual([]);
    expect(summary.cuts).toEqual(["1000-1500 filler", "3000-3600 pause"]);
  });

  it("a perfect answer has no misses and no wrong keeps", () => {
    const cuts = [
      { startMs: 1000, endMs: 2000, kind: "filler" },
      { startMs: 3000, endMs: 4000, kind: "pause" },
    ] as const;
    const summary = buildCaseSummary(report, expected, cuts);
    expect(summary.missed).toEqual([]);
    expect(summary.wrongKeeps).toEqual([]);
  });

  it("the run output has one summary per case and holds no transcript text or reason", async () => {
    const reason = "A distinctive reason the model wrote";
    const answer = JSON.stringify({
      keepPauses: [],
      wordCuts: [{ fromWord: 0, toWord: 0, kind: "filler", reason }],
      fixes: [],
      background: null,
    });
    const { io } = harness(vi.fn(async () => answerFor(answer)));
    const out = await runAiEval({ token: TOKEN }, ENV, io);
    if (out.outcome !== "done") throw new Error("expected a done run");
    expect(out.summary.map((c) => c.id)).toEqual(
      CASE_ENTRIES.map((e) => (e.raw as { id: string }).id),
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain(reason);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(KEY);
    for (const secret of secretsOfCases().filter((w) => w.length >= 7)) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("saving the run (B2-T72)", () => {
  const answer = () => Promise.resolve(answerFor(emptyAnswer));

  it("hands the totals and the per case summary to save, and reports saved", async () => {
    const { io } = harness(answer);
    const save = vi.fn(async () => undefined);
    const result = await runAiEval({ token: TOKEN }, ENV, { ...io, save });
    expect(save).toHaveBeenCalledTimes(1);
    const [run] = save.mock.calls[0] as unknown as [
      { model: string; all: { cases: number }; summary: unknown[] },
    ];
    expect(run.all.cases).toBe(CASE_ENTRIES.length);
    expect(run.summary).toHaveLength(CASE_ENTRIES.length);
    expect(result).toMatchObject({ outcome: "done", saved: true });
  });

  it("still finishes when saving fails, and logs no error text", async () => {
    const { io, lines } = harness(answer);
    const save = vi.fn(async () => {
      throw new Error("connection string postgres://secret");
    });
    const result = await runAiEval({ token: TOKEN }, ENV, { ...io, save });
    expect(result).toMatchObject({ outcome: "done", saved: false });
    expect(JSON.stringify(lines)).not.toContain("secret");
    expect(lines.some((l) => l.message === "ai-eval: save failed")).toBe(true);
  });

  it("saves nothing for a skipped run", async () => {
    const { io } = harness(answer);
    const save = vi.fn(async () => undefined);
    await runAiEval({ token: "wrong" }, ENV, { ...io, save });
    expect(save).not.toHaveBeenCalled();
  });
});
