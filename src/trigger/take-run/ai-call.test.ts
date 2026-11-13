import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AiCallError, classifyAiError } from "./ai-call";

const live = new AbortController().signal;
const headers = new Headers();
const http = (status: number) => Anthropic.APIError.generate(status, {}, "x", headers);

describe("classifyAiError (AC-9: retry 429, 5xx, network only)", () => {
  it.each([
    [429, "provider_error", true],
    [500, "provider_error", true],
    [529, "provider_error", true],
    [400, "provider_rejected", false],
    [401, "provider_rejected", false],
    [404, "provider_rejected", false],
  ])("status %i", (status, cause, retryable) => {
    const out = classifyAiError(http(status), live);
    expect([out.cause, out.retryable]).toEqual([cause, retryable]);
  });

  it("a network error is retryable, the SDK's own timeout is not", () => {
    expect(classifyAiError(new Anthropic.APIConnectionError({}), live).retryable).toBe(true);
    const t = classifyAiError(new Anthropic.APIConnectionTimeoutError(), live);
    expect([t.cause, t.retryable]).toEqual(["timeout", false]);
  });

  it("the edit deadline wins over anything else", () => {
    const c = new AbortController();
    c.abort();
    expect(classifyAiError(new AiCallError("provider_error", true), c.signal).cause).toBe(
      "timeout",
    );
    expect(classifyAiError(new Anthropic.APIUserAbortError(), live).cause).toBe("timeout");
  });

  it("an unknown error is provider_error and not retried", () => {
    const out = classifyAiError(new Error("boom"), live);
    expect([out.cause, out.retryable]).toEqual(["provider_error", false]);
  });
});
