import { describe, expect, it, vi } from "vitest";
import { CASE_ENTRIES } from "../../../tests/cut-quality/cases";
import type { AiCallResult } from "../take-run/ai-call";
import { type EvalIo, buildCaseSummary, runAiEval } from "./run-eval";

// Test values only; the real ones are AI_EVAL_TOKEN and ANTHROPIC_API_KEY in the Trigger.dev environment.
const TOKEN = "eval-token-0123456789";
const KEY = "sk-test-key-0123456789";
const ENV = { AI_EVAL_TOKEN: TOKEN, ANTHROPIC_API_KEY: KEY };

type Line = { message: string; fields: Record<string, string | number | boolean> };

function harness(call: EvalIo["call"]) {
  const lines: Line[] = [];
  let clock = 0;
  const io: EvalIo = {
    call,
    now: () => (clock += 500),
    log: (message, fields) => lines.push({ message, fields: { ...fields } }),
  };
  return { io, lines };
}

const emptyAnswer = JSON.stringify({ keepPauses: [], wordCuts: [], fixes: [], background: null });
const answerFor = (text: string | null, stopReason = "end_turn"): AiCallResult => ({
  text,
  stopReason,
  inputTokens: 100,
  outputTokens: 20,
});

/** Every word, reason and note of every case: none of it may appear in a log line. */
function secretsOfCases(): string[] {
  return CASE_ENTRIES.flatMap((e) => {
    const raw = e.raw as { words: { w: string }[]; note?: string };
    const words = raw.words.map((w) => w.w).filter((w) => w.length >= 3);
    return [...words, ...(raw.note ? [raw.note] : [])];
  });
}

describe("runAiEval token gate (spec 0017, AC-10)", () => {
  it("makes no model call for a wrong, empty, missing or malformed token", async () => {
    const call = vi.fn();
    for (const payload of [{ token: "nope" }, { token: "" }, {}, null, "x", { token: 5 }]) {
      const { io, lines } = harness(call);
      expect(await runAiEval(payload, ENV, io)).toEqual({ outcome: "skipped" });
      expect(lines).toEqual([]);
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("makes no model call when the environment has no token, whatever the payload", async () => {
    const call = vi.fn();
    const { io } = harness(call);
    expect(
      await runAiEval({ token: "anything" }, { ...ENV, AI_EVAL_TOKEN: undefined }, io),
    ).toEqual({ outcome: "skipped" });
    expect(await runAiEval({ token: "" }, { ...ENV, AI_EVAL_TOKEN: "" }, io)).toEqual({
      outcome: "skipped",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("with the right token and no Anthropic key, stops with no_key and no call", async () => {
    const call = vi.fn();
    const { io } = harness(call);
    const out = await runAiEval({ token: TOKEN }, { ...ENV, ANTHROPIC_API_KEY: undefined }, io);
    expect(out).toEqual({ outcome: "no_key" });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("runAiEval run", () => {
  it("calls the model once per case and logs one line per case plus three totals", async () => {
    const call = vi.fn(async () => answerFor(emptyAnswer));
    const { io, lines } = harness(call);
    const out = await runAiEval({ token: TOKEN }, ENV, io);
    expect(out).toMatchObject({ outcome: "done", cases: CASE_ENTRIES.length });
    expect(call).toHaveBeenCalledTimes(CASE_ENTRIES.length);
    expect(lines.filter((l) => l.message === "ai-eval: case")).toHaveLength(CASE_ENTRIES.length);
    const totals = lines.filter((l) => l.message === "ai-eval: total");
    expect(totals.map((l) => l.fields.group)).toEqual(["main", "holdout", "all"]);
    const holdoutCases = CASE_ENTRIES.filter((e) => e.holdout).length;
    expect(totals[1]?.fields.cases).toBe(holdoutCases);
    expect(totals[2]?.fields).toMatchObject({
      cases: CASE_ENTRIES.length,
      inputTokens: 100 * CASE_ENTRIES.length,
      outputTokens: 20 * CASE_ENTRIES.length,
    });
  });

  it("reports the numbers of a case: the recorded answer scores like the CI test", async () => {
    // Answer each case with its recorded answer, in the order the run asks.
    let i = 0;
    const call = vi.fn(async () => answerFor(JSON.stringify(CASE_ENTRIES[i++]?.answer)));
    const { io, lines } = harness(call);
    await runAiEval({ token: TOKEN }, ENV, io);
    const cases = lines.filter((l) => l.message === "ai-eval: case");
    for (const l of cases) {
      expect(l.fields.fallback).toBe("none");
      expect(l.fields.recall).toBeGreaterThanOrEqual(0);
      expect(l.fields.recall).toBeLessThanOrEqual(1);
      expect(l.fields.seconds).toBe(0.5);
    }
  });

  it("scores the rules cuts and names a cause when the answer is unusable", async () => {
    const answers = [
      answerFor("not json"),
      answerFor(emptyAnswer, "max_tokens"),
      answerFor(emptyAnswer, "refusal"),
      answerFor(null),
    ];
    let i = 0;
    const call = vi.fn(async () => answers[i++ % answers.length]!);
    const { io, lines } = harness(call);
    await runAiEval({ token: TOKEN }, ENV, io);
    const causes = lines
      .filter((l) => l.message === "ai-eval: case")
      .slice(0, 4)
      .map((l) => l.fields.fallback);
    expect(causes).toEqual(["invalid", "cutoff", "provider_rejected", "invalid"]);
  });

  it("turns a failing call into a cause name, never the error text", async () => {
    const call = vi.fn(async () => {
      throw new Error(`boom ${KEY} ${TOKEN} some transcript words`);
    });
    const { io, lines } = harness(call);
    const out = await runAiEval({ token: TOKEN }, ENV, io);
    expect(out).toMatchObject({ outcome: "done" });
    expect(lines.filter((l) => l.message === "ai-eval: case")[0]?.fields.fallback).toBe(
      "provider_error",
    );
    const text = JSON.stringify(lines);
    expect(text).not.toContain("boom");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TOKEN);
  });

  it("log lines hold no transcript text, answer text, token or key", async () => {
    const reason = "A distinctive reason the model wrote";
    const answer = JSON.stringify({
      keepPauses: [],
      wordCuts: [{ fromWord: 0, toWord: 0, kind: "filler", reason }],
      fixes: [],
      background: null,
    });
    const call = vi.fn(async () => answerFor(answer));
    const { io, lines } = harness(call);
    await runAiEval({ token: TOKEN }, ENV, io);
    const text = JSON.stringify(lines);
    const secrets = secretsOfCases();
    // Long words must not appear anywhere; short ones (which can collide with a field name such as
    // "back" in "fallback") must not appear as any string value.
    for (const secret of secrets.filter((w) => w.length >= 7)) expect(text).not.toContain(secret);
    const stringValues = lines.flatMap((l) =>
      Object.entries(l.fields).flatMap(([k, v]) =>
        typeof v === "string" && k !== "caseId" ? [v.toLowerCase()] : [],
      ),
    );
    for (const secret of secrets) expect(stringValues).not.toContain(secret.toLowerCase());
    expect(text).not.toContain(reason);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(KEY);
    // Only numbers, flags and short names appear as values.
    for (const l of lines)
      for (const v of Object.values(l.fields)) expect(String(v).length).toBeLessThan(40);
  });
});

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
