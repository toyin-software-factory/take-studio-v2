import { describe, expect, it, vi } from "vitest";
import { runAiKeyCheck } from "./ai-key-check";

// Test values only; the real ones are SENTRY_CHECK_TOKEN and ANTHROPIC_API_KEY in Trigger.dev.
const TOKEN = "test-token-0123456789";
const KEY = "sk-ant-test-0123456789abcdef";

const okIo = () => ({
  call: vi.fn(async () => ({
    status: 429,
    headers: {
      "request-id": "req_9",
      "anthropic-ratelimit-tokens-limit": "1000",
      "x-api-key": KEY,
    },
    errorType: "rate_limit_error",
  })),
});

describe("runAiKeyCheck (B-T17)", () => {
  it("makes exactly one call and returns the stripped result for the exact token", async () => {
    const io = okIo();
    const result = await runAiKeyCheck({ token: TOKEN }, { token: TOKEN, apiKey: KEY }, io);
    expect(io.call).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "checked",
      status: 429,
      requestId: "req_9",
      rateLimit: { "anthropic-ratelimit-tokens-limit": "1000" },
      errorType: "rate_limit_error",
      keyLength: KEY.length,
    });
  });

  it("does nothing, and calls nothing, for a wrong, empty, missing or malformed token", async () => {
    for (const payload of [{ token: "nope" }, { token: "" }, {}, null, "x", { token: 5 }]) {
      const io = okIo();
      expect(await runAiKeyCheck(payload, { token: TOKEN, apiKey: KEY }, io)).toEqual({
        outcome: "skipped",
      });
      expect(io.call).not.toHaveBeenCalled();
    }
  });

  it("does nothing when the environment has no token", async () => {
    const io = okIo();
    expect(
      await runAiKeyCheck({ token: "anything" }, { token: undefined, apiKey: KEY }, io),
    ).toEqual({ outcome: "skipped" });
    expect(await runAiKeyCheck({ token: "" }, { token: "", apiKey: KEY }, io)).toEqual({
      outcome: "skipped",
    });
    expect(io.call).not.toHaveBeenCalled();
  });

  it("says no_key without calling when the key is missing", async () => {
    const io = okIo();
    expect(await runAiKeyCheck({ token: TOKEN }, { token: TOKEN, apiKey: undefined }, io)).toEqual({
      outcome: "no_key",
    });
    expect(io.call).not.toHaveBeenCalled();
  });

  it("never puts the key or the token in the result", async () => {
    const text = JSON.stringify(
      await runAiKeyCheck({ token: TOKEN }, { token: TOKEN, apiKey: KEY }, okIo()),
    );
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TOKEN);
  });
});
