import { CASE_ENTRIES } from "../../../tests/cut-quality/cases";
import type { AiCallResult } from "../take-run/ai-call";
import { type EvalIo } from "./run-eval";

// Test values only; the real ones are AI_EVAL_TOKEN and ANTHROPIC_API_KEY in the Trigger.dev environment.
export const TOKEN = "eval-token-0123456789";
export const KEY = "sk-test-key-0123456789";
export const ENV = { AI_EVAL_TOKEN: TOKEN, ANTHROPIC_API_KEY: KEY };

export type Line = {
  message: string;
  fields: Readonly<Record<string, string | number | boolean | readonly string[]>>;
};

export function harness(call: EvalIo["call"]) {
  const lines: Line[] = [];
  let clock = 0;
  const io: EvalIo = {
    call,
    now: () => (clock += 500),
    log: (message, fields) => lines.push({ message, fields: { ...fields } }),
  };
  return { io, lines };
}

export const emptyAnswer = JSON.stringify({
  keepPauses: [],
  wordCuts: [],
  fixes: [],
  background: null,
});
export const answerFor = (text: string | null, stopReason = "end_turn"): AiCallResult => ({
  text,
  stopReason,
  inputTokens: 100,
  outputTokens: 20,
});

/** Every word, reason and note of every case: none of it may appear in a log line. */
export function secretsOfCases(): string[] {
  return CASE_ENTRIES.flatMap((e) => {
    const raw = e.raw as { words: { w: string }[]; note?: string };
    const words = raw.words.map((w) => w.w).filter((w) => w.length >= 3);
    return [...words, ...(raw.note ? [raw.note] : [])];
  });
}
