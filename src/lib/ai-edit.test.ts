import { describe, expect, it } from "vitest";
import {
  AI_EDIT,
  CHARS_PER_TOKEN,
  FIXED_INPUT_TOKENS,
  aiEditAnswerSchema,
  buildAiRequest,
  estimateInputTokens,
} from "./ai-edit";
import { CANDS, DURATION, WORDS, empty, w } from "./ai-edit-test-helpers";

describe("buildAiRequest (AC-8)", () => {
  const req = buildAiRequest({ words: WORDS, candidates: CANDS, durationMs: DURATION });
  it("lists words in the compact line form and the candidates", () => {
    expect(req.user).toContain("0|Hello|0|400|\n1|um|500|700|f\n");
    expect(req.user).toContain("PAUSES\n0|2100|3900\n1|5100|9900");
    expect(req.user).toContain("TAKE_LENGTH_MS 10000");
    expect(req.user).not.toContain("BACKGROUNDS");
  });
  it("cannot leak what it is never given", () => {
    const text = `${req.system}\n${req.user}`;
    for (const needle of ["@", "http", "title", "uuid", "creator"]) {
      expect(text.toLowerCase()).not.toContain(needle === "title" ? "take title" : needle);
    }
  });
  it("keeps a pipe or line break in a word from breaking its line", () => {
    const r = buildAiRequest({ words: [w("a|b\nc", 0, 1)], candidates: [], durationMs: 5 });
    expect(r.user).toContain("0|a b c|0|1|");
  });
  it("lists the catalog when given one", () => {
    const r = buildAiRequest({
      words: [],
      candidates: [],
      durationMs: 5,
      catalog: [{ id: "x", name: "Loft", alt: "A loft" }],
    });
    expect(r.user).toContain("BACKGROUNDS\nx|Loft|A loft");
  });
  it("estimates the two real counts of the C-15 measurement within 15 %", () => {
    // Characters of the request and the input tokens Anthropic counted for it.
    for (const [chars, real] of [
      [2670, 1972],
      [34_623, 17_884],
    ] as const) {
      const estimate = estimateInputTokens(chars);
      expect(Math.abs(estimate - real) / real).toBeLessThan(0.15);
    }
  });
  it("estimates from the system prompt plus the user message", () => {
    const r = buildAiRequest({ words: [w("hi", 0, 1)], candidates: [], durationMs: 5 });
    expect(r.estimatedInputTokens).toBe(estimateInputTokens(r.system.length + r.user.length));
  });
  it("sits on the guard exactly: the last size at 60 000 passes, one more character is over", () => {
    const atGuard = (AI_EDIT.maxInputTokens - FIXED_INPUT_TOKENS) * CHARS_PER_TOKEN;
    expect(estimateInputTokens(atGuard)).toBe(AI_EDIT.maxInputTokens);
    expect(estimateInputTokens(atGuard + 1)).toBeGreaterThan(AI_EDIT.maxInputTokens);
  });
  it("estimates a 10 minute take well under the guard", () => {
    const many = Array.from({ length: 1500 }, (_, i) => w("word", i * 400, i * 400 + 300));
    const big = buildAiRequest({ words: many, candidates: [], durationMs: 600_000 });
    expect(big.estimatedInputTokens).toBeLessThan(AI_EDIT.maxInputTokens);
  });
});
describe("aiEditAnswerSchema", () => {
  it("accepts the shape and rejects others", () => {
    expect(aiEditAnswerSchema.safeParse(empty).success).toBe(true);
    expect(aiEditAnswerSchema.safeParse({ keepPauses: [] }).success).toBe(false);
    expect(aiEditAnswerSchema.safeParse({ ...empty, background: undefined }).success).toBe(false);
  });
});
