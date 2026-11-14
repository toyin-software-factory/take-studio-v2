import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 0012 AC-9: the shape of the one Claude request. The SDK is replaced by a recorder, so
// nothing leaves the machine and no key is needed.
const recorded = vi.hoisted(() => ({
  clientOptions: [] as unknown[],
  bodies: [] as Record<string, unknown>[],
  requestOptions: [] as unknown[],
}));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    constructor(options: unknown) {
      recorded.clientOptions.push(options);
    }
    messages = {
      create: (body: Record<string, unknown>, options: unknown) => {
        recorded.bodies.push(body);
        recorded.requestOptions.push(options);
        return Promise.resolve({
          content: [{ type: "text", text: "{}" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      },
    };
    static APIError = class extends Error {};
    static APIUserAbortError = class extends Error {};
    static APIConnectionError = class extends Error {};
    static APIConnectionTimeoutError = class extends Error {};
  }
  return { default: FakeAnthropic };
});

import { AI_EDIT } from "@/lib/ai-edit";
import { callClaude } from "./ai-call";

beforeEach(() => {
  recorded.clientOptions.length = 0;
  recorded.bodies.length = 0;
  recorded.requestOptions.length = 0;
});

describe("callClaude request (AC-9)", () => {
  it("sends one non streaming request with the fixed cap, effort low and no thinking parameter", async () => {
    const signal = new AbortController().signal;
    const out = await callClaude({ system: "S", user: "U" }, "key", signal);

    expect(recorded.bodies).toHaveLength(1);
    const body = recorded.bodies[0]!;
    expect(body.max_tokens).toBe(8000);
    expect(body.max_tokens).toBe(AI_EDIT.maxTokens);
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("stream");
    expect(body.output_config).toMatchObject({
      effort: "low",
      format: { type: "json_schema" },
    });
    expect(body.messages).toEqual([{ role: "user", content: "U" }]);
    expect(recorded.requestOptions[0]).toEqual({ signal });
    expect(out).toEqual({ text: "{}", stopReason: "end_turn", inputTokens: 10, outputTokens: 5 });
  });

  it("turns the SDK's own retries off, so only our one retry exists", async () => {
    await callClaude({ system: "S", user: "U" }, "key", new AbortController().signal);
    expect(recorded.clientOptions).toEqual([{ apiKey: "key", maxRetries: 0 }]);
  });
});
