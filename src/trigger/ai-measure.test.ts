import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  task: (definition: unknown) => definition,
  AbortTaskRunError: class extends Error {},
}));

import { realCatalog } from "@/lib/ai-measure";
import { type AiMeasureIo, realAiMeasureIo, runAiMeasure } from "./ai-measure";
import { AiCallError } from "./take-run/ai-call";

// Test values only. The real token is SENTRY_CHECK_TOKEN in Trigger.dev.
const TOKEN = "test-token-0123456789";
const DG_KEY = "dg-test-key-0123456789";
const AI_KEY = "sk-ant-test-0123456789abcdef";
const SECRET_WORDS = ["Hello", "um", "I'm", "Jon"];

const deepgramBody = {
  results: {
    channels: [
      {
        detected_language: "en",
        alternatives: [
          {
            transcript: SECRET_WORDS.join(" "),
            words: SECRET_WORDS.map((w, i) => ({
              word: w.toLowerCase(),
              punctuated_word: w,
              start: i * 0.6,
              end: i * 0.6 + 0.5,
              confidence: 1,
            })),
            paragraphs: { paragraphs: [{ start: 0 }] },
          },
        ],
      },
    ],
  },
};

const answer = {
  keepPauses: [{ candidate: 0, reason: "SECRET reason to keep" }],
  wordCuts: [{ fromWord: 1, toWord: 1, kind: "filler", reason: "SECRET filler" }],
  fixes: [],
  background: null,
};

function makeIo(over: Partial<AiMeasureIo> = {}) {
  let clock = 1_000;
  const call = vi.fn(async () => ({
    text: JSON.stringify(answer),
    stopReason: "end_turn",
    inputTokens: 1200,
    outputTokens: 80,
  }));
  const prepareClip = vi.fn(async () => ({ path: "/tmp/none.mp4", cleanup: async () => {} }));
  const io: AiMeasureIo = {
    prepareClip,
    durationMs: async () => 5_000,
    candidates: async () => [{ startMs: 1_000, endMs: 2_000, reason: "pause" }],
    transcript: {
      apiKey: () => DG_KEY,
      extractAudio: async (_s, out) => writeFile(out, "audio"),
      post: async () => deepgramBody,
      pause: async () => {},
    },
    ai: { apiKey: () => AI_KEY, call, pause: async () => {}, report: vi.fn() },
    catalog: realCatalog(),
    // Every reading of the clock moves it 100 ms.
    now: () => (clock += 100),
    ...over,
  };
  return { io, call, prepareClip };
}

describe("runAiMeasure (B-T18)", () => {
  it("measures one clip: timings, tokens and cut counts", async () => {
    const { io, call } = makeIo();
    const result = await runAiMeasure({ token: TOKEN, clip: "speech" }, TOKEN, io);
    expect(call).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "measured",
      clip: "speech",
      clipMs: 5_000,
      words: 4,
      candidates: 1,
      inputTokens: 1200,
      outputTokens: 80,
      aiCuts: 2,
      aiCutsApplied: 1,
      fallback: null,
      withinDeadline: true,
      deadlineMs: 120_000,
      catalogEntries: realCatalog().length,
    });
    if (result.outcome !== "measured") throw new Error("not measured");
    expect(result.totalMs).toBe(result.transcriptMs + result.aiEditMs);
    expect(result.transcriptMs).toBeGreaterThan(0);
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
  });

  it("does nothing and prepares nothing for a wrong, empty, missing or malformed token or clip", async () => {
    for (const payload of [
      { token: "nope", clip: "speech" },
      { token: "", clip: "speech" },
      { clip: "speech" },
      { token: TOKEN },
      { token: TOKEN, clip: "long" },
      null,
      "x",
    ]) {
      const { io, call, prepareClip } = makeIo();
      expect(await runAiMeasure(payload, TOKEN, io)).toEqual({ outcome: "skipped" });
      expect(prepareClip).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("does nothing when the environment has no token", async () => {
    const { io, prepareClip } = makeIo();
    expect(await runAiMeasure({ token: "x", clip: "speech" }, undefined, io)).toEqual({
      outcome: "skipped",
    });
    expect(prepareClip).not.toHaveBeenCalled();
  });

  it("names the missing key and does no work", async () => {
    const dg = makeIo();
    dg.io = { ...dg.io, transcript: { ...dg.io.transcript, apiKey: () => null } };
    expect(await runAiMeasure({ token: TOKEN, clip: "speech" }, TOKEN, dg.io)).toEqual({
      outcome: "no_key",
      missing: "deepgram",
    });
    const ai = makeIo();
    ai.io = { ...ai.io, ai: { ...ai.io.ai, apiKey: () => null } };
    expect(await runAiMeasure({ token: TOKEN, clip: "ten-min" }, TOKEN, ai.io)).toEqual({
      outcome: "no_key",
      missing: "anthropic",
    });
    expect(dg.prepareClip).not.toHaveBeenCalled();
    expect(ai.prepareClip).not.toHaveBeenCalled();
  });

  it("reports a Claude failure as a fallback cause, with no AI numbers", async () => {
    const base = makeIo();
    const io: AiMeasureIo = {
      ...base.io,
      ai: {
        ...base.io.ai,
        call: async () => {
          throw new AiCallError("provider_rejected", false);
        },
      },
    };
    expect(await runAiMeasure({ token: TOKEN, clip: "speech" }, TOKEN, io)).toMatchObject({
      outcome: "measured",
      fallback: "provider_rejected",
      inputTokens: null,
      aiCuts: null,
    });
  });

  it("reports an unusable answer as invalid but keeps the token counts", async () => {
    const base = makeIo();
    const io: AiMeasureIo = {
      ...base.io,
      ai: {
        ...base.io.ai,
        call: async () => ({
          text: "not json {",
          stopReason: "end_turn",
          inputTokens: 9,
          outputTokens: 3,
        }),
      },
    };
    expect(await runAiMeasure({ token: TOKEN, clip: "speech" }, TOKEN, io)).toMatchObject({
      fallback: "invalid",
      inputTokens: 9,
      outputTokens: 3,
      aiCuts: null,
    });
  });

  it("reports a failed transcript and never calls Claude", async () => {
    const { io: base, call } = makeIo();
    const io: AiMeasureIo = {
      ...base,
      transcript: {
        ...base.transcript,
        post: async () => {
          throw new Error("boom");
        },
      },
    };
    expect(await runAiMeasure({ token: TOKEN, clip: "speech" }, TOKEN, io)).toMatchObject({
      fallback: "transcript_failed",
      aiEditMs: 0,
      words: 0,
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("returns numbers and fixed words only: no text, key or token anywhere", async () => {
    const { io } = makeIo();
    const result = await runAiMeasure({ token: TOKEN, clip: "ten-min" }, TOKEN, io);
    const text = JSON.stringify(result);
    for (const forbidden of [...SECRET_WORDS, "SECRET", AI_KEY, DG_KEY, TOKEN]) {
      expect(text).not.toContain(forbidden);
    }
    if (result.outcome !== "measured") throw new Error("not measured");
    for (const [name, value] of Object.entries(result)) {
      if (typeof value === "string") {
        expect(["outcome", "clip", "fallback"]).toContain(name);
      }
    }
  });
});

describe("realAiMeasureIo.durationMs (ten-min path)", () => {
  it("gives the audio only ten minute clip its fixed 600 s without probing a video stream", async () => {
    // The file does not exist: the answer must come from the clip's fixed length, not a probe.
    expect(await realAiMeasureIo.durationMs("/nonexistent/ten-min.m4a")).toBe(600_000);
  });
});
