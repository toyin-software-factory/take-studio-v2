import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_QUEUED_ERRORS,
  errorFromEvent,
  reportBrowserError,
  resetBrowserErrors,
  setBrowserReporter,
} from "./browser-errors";

describe("browser error queue", () => {
  beforeEach(resetBrowserErrors);

  it("keeps errors until the reporter is set, then replays them in order", () => {
    const a = new Error("a");
    const b = new Error("b");
    reportBrowserError(a);
    reportBrowserError(b);
    const reporter = vi.fn();
    setBrowserReporter(reporter);
    expect(reporter.mock.calls).toEqual([[a], [b]]);
  });

  it("reports at once after the reporter is set and does not replay twice", () => {
    const reporter = vi.fn();
    setBrowserReporter(reporter);
    reportBrowserError("late");
    setBrowserReporter(reporter);
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("caps the queue", () => {
    for (let i = 0; i < MAX_QUEUED_ERRORS + 5; i++) reportBrowserError(i);
    const reporter = vi.fn();
    setBrowserReporter(reporter);
    expect(reporter).toHaveBeenCalledTimes(MAX_QUEUED_ERRORS);
  });

  it("makes an error from a window event without one", () => {
    const made = errorFromEvent({ error: null, message: "boom" } as ErrorEvent);
    expect(made).toBeInstanceOf(Error);
    expect((made as Error).message).toBe("boom");
  });
});
