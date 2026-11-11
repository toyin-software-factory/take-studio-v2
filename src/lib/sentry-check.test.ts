import { describe, expect, it } from "vitest";
import { sentryCheckAllowed } from "./sentry-check";

describe("sentryCheckAllowed", () => {
  const token = "a-long-random-test-token-0123456789abcdef";

  it("allows only the exact token", async () => {
    expect(await sentryCheckAllowed(token, token)).toBe(true);
    expect(await sentryCheckAllowed(`${token}x`, token)).toBe(false);
    expect(await sentryCheckAllowed(token.slice(0, -1), token)).toBe(false);
    expect(await sentryCheckAllowed(token.toUpperCase(), token)).toBe(false);
  });

  it("refuses when the token or the header is missing", async () => {
    expect(await sentryCheckAllowed(token, undefined)).toBe(false);
    expect(await sentryCheckAllowed(token, "")).toBe(false);
    expect(await sentryCheckAllowed(null, token)).toBe(false);
    expect(await sentryCheckAllowed("", "")).toBe(false);
  });
});
