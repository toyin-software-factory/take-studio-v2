import { describe, expect, it } from "vitest";
import { buildCheckedResult, errorTypeFrom, keyFingerprint, pickHeaders } from "./ai-key-check";

// Test values only.
const KEY = "sk-ant-test-0123456789abcdef";

describe("pickHeaders", () => {
  it("keeps only the request ID, retry-after and anthropic-ratelimit-* headers", () => {
    const headers = new Headers({
      "Request-Id": "req_123",
      "Retry-After": "30",
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-output-tokens-remaining": "0",
      "set-cookie": "a=b",
      authorization: "Bearer x",
      "x-api-key": KEY,
      "cf-ray": "abc",
      "anthropic-organization-id": "org-1",
    });
    expect(pickHeaders(headers)).toEqual({
      "anthropic-ratelimit-output-tokens-remaining": "0",
      "anthropic-ratelimit-requests-limit": "50",
      "request-id": "req_123",
      "retry-after": "30",
    });
  });

  it("works on a plain object and on nothing", () => {
    expect(pickHeaders({ "Retry-After": "5", "x-api-key": KEY, bad: 3 })).toEqual({
      "retry-after": "5",
    });
    expect(pickHeaders(null)).toEqual({});
    expect(pickHeaders(undefined)).toEqual({});
  });

  it("cuts a long value", () => {
    expect(pickHeaders({ "retry-after": "9".repeat(500) })["retry-after"]).toHaveLength(120);
  });
});

describe("errorTypeFrom", () => {
  it("gives the type of an error body and nothing else", () => {
    expect(
      errorTypeFrom({ type: "error", error: { type: "rate_limit_error", message: "x" } }),
    ).toBe("rate_limit_error");
  });
  it("gives unknown for anything odd (never free text)", () => {
    for (const body of [null, undefined, "x", {}, { error: { type: "Has Spaces and text" } }]) {
      expect(errorTypeFrom(body)).toBe("unknown");
    }
  });
});

describe("keyFingerprint", () => {
  it("is the first 8 hex of the SHA 256 and the length, nothing from the key", async () => {
    const f = await keyFingerprint(KEY);
    expect(f.sha8).toMatch(/^[0-9a-f]{8}$/);
    expect(f.length).toBe(KEY.length);
    expect(JSON.stringify(f)).not.toContain(KEY);
    expect(await keyFingerprint("abc")).toEqual({ sha8: "ba7816bf", length: 3 });
  });
});

describe("buildCheckedResult", () => {
  const fingerprint = { sha8: "0037c768", length: 106 };

  it("shapes a 429 with its headers and never contains the key", () => {
    const result = buildCheckedResult(
      {
        status: 429,
        headers: {
          "request-id": "req_1",
          "anthropic-ratelimit-requests-remaining": "0",
          "x-api-key": KEY,
        },
        errorType: "rate_limit_error",
      },
      fingerprint,
    );
    expect(result).toEqual({
      outcome: "checked",
      status: 429,
      requestId: "req_1",
      retryAfter: null,
      rateLimit: { "anthropic-ratelimit-requests-remaining": "0" },
      errorType: "rate_limit_error",
      keySha8: "0037c768",
      keyLength: 106,
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("shapes a success and a connection failure", () => {
    expect(
      buildCheckedResult({ status: 200, headers: {}, errorType: null }, fingerprint),
    ).toMatchObject({
      status: 200,
      errorType: null,
      rateLimit: {},
    });
    expect(
      buildCheckedResult(
        { status: null, headers: null, errorType: "connection_error" },
        fingerprint,
      ),
    ).toMatchObject({ status: null, requestId: null, errorType: "connection_error" });
  });
});
