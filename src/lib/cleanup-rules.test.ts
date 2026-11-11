import { describe, expect, it } from "vitest";
import {
  CLEANUP,
  PROCESS_TAKE_LIMITS,
  cleanupCutoffs,
  ownsTakeAfterFailure,
} from "./cleanup-rules";

describe("cleanup cut offs (AC-18)", () => {
  it("derives each cut off from now and the constants", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(cleanupCutoffs(now)).toEqual({
      abandonedUploadBefore: new Date("2026-11-11T10:45:00Z"), // 60 min link + 15 min margin
      queuedJobBefore: new Date("2026-11-11T11:45:00Z"), // 15 min
      runningJobBefore: new Date("2026-11-11T10:35:00Z"), // 2 attempts x 40 min maxDuration + 5 min margin
    });
  });

  it("derives the running job window from the task's attempts and maxDuration", () => {
    expect(CLEANUP.jobMaxDurationMs).toBe(
      PROCESS_TAKE_LIMITS.maxAttempts * PROCESS_TAKE_LIMITS.maxDurationSeconds * 1000,
    );
    // Never shorter than one full attempt, so cleanup cannot fail a job that is still within
    // its task limit (even a retry that keeps the first attempt's started_at).
    expect(CLEANUP.jobMaxDurationMs + CLEANUP.runningStaleMarginMs).toBeGreaterThan(
      PROCESS_TAKE_LIMITS.maxDurationSeconds * 1000 * PROCESS_TAKE_LIMITS.maxAttempts,
    );
  });
});

describe("probe ownership after a failure (S1C-T09)", () => {
  it("only the newest dispatch may fail the take", () => {
    expect(ownsTakeAfterFailure(undefined, 0)).toBe(true); // the upload completion's run
    expect(ownsTakeAfterFailure(0, 0)).toBe(true);
    expect(ownsTakeAfterFailure(0, 1)).toBe(false); // an older run, cleanup dispatched a newer one
    expect(ownsTakeAfterFailure(2, 3)).toBe(false);
    expect(ownsTakeAfterFailure(3, 3)).toBe(true); // the newest
  });
});
