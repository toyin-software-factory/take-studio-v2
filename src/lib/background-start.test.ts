import { describe, expect, it } from "vitest";
import { backgroundStartMessage, refusalMeansStalePage } from "./background-start";

describe("backgroundStartMessage (S3S-T13)", () => {
  it("shows the server's friendly message when there is one", () => {
    const message = "That background isn't ready yet. Try again in a moment.";
    expect(backgroundStartMessage(409, { error: "background_not_ready", message })).toBe(message);
    expect(
      backgroundStartMessage(429, { error: "background_change_limit", message: "Later." }),
    ).toBe("Later.");
  });

  it("words the 409 for a change that is already running", () => {
    expect(backgroundStartMessage(409, null)).toBe(
      "A background change is already running. It'll show here when it's done.",
    );
  });

  it("never stays silent when the answer has no message", () => {
    for (const status of [401, 403, 404, 409, 422, 429, 500, 502, 503]) {
      for (const data of [null, {}, "<html>", { error: "x" }]) {
        expect(backgroundStartMessage(status, data).length).toBeGreaterThan(10);
      }
    }
    expect(backgroundStartMessage(401, null)).toContain("signed out");
    expect(backgroundStartMessage(409, null)).toContain("already running");
    expect(backgroundStartMessage(502, null)).toBe("The change didn't start. Please try again.");
  });

  it("asks the page to read the take again for a 409 or 404 only", () => {
    expect(refusalMeansStalePage(409)).toBe(true);
    expect(refusalMeansStalePage(404)).toBe(true);
    expect(refusalMeansStalePage(429)).toBe(false);
    expect(refusalMeansStalePage(503)).toBe(false);
  });
});
