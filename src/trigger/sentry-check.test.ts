import { describe, expect, it } from "vitest";
import { runSentryCheck } from "./sentry-check";

// Test value only; the real token is SENTRY_CHECK_TOKEN in the Trigger.dev environment.
const TOKEN = "test-token-0123456789";

describe("runSentryCheck (spec 0005, AC-3)", () => {
  it("throws inside the task only for the exact token", async () => {
    await expect(runSentryCheck({ token: TOKEN }, TOKEN)).rejects.toThrowError(
      /Sentry check: deliberate job error/,
    );
  });

  it("does nothing for a wrong, empty, missing or malformed token", async () => {
    for (const payload of [{ token: "nope" }, { token: "" }, {}, null, "x", { token: 5 }]) {
      expect(await runSentryCheck(payload, TOKEN)).toEqual({ outcome: "skipped" });
    }
  });

  it("does nothing when the environment has no token, even for an empty or any payload", async () => {
    expect(await runSentryCheck({ token: "anything" }, undefined)).toEqual({ outcome: "skipped" });
    expect(await runSentryCheck({ token: "" }, "")).toEqual({ outcome: "skipped" });
  });

  it("never puts the token in the result", async () => {
    expect(JSON.stringify(await runSentryCheck({ token: "wrong" }, TOKEN))).not.toContain(TOKEN);
  });
});
