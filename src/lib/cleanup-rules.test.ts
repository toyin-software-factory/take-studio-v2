import { describe, expect, it } from "vitest";
import {
  CLEANUP,
  PROCESS_TAKE_LIMITS,
  TRANSCRIBE_TAKE_LIMITS,
  cleanupCutoffs,
  ownsTakeAfterFailure,
} from "./cleanup-rules";

describe("cleanup cut offs (AC-18)", () => {
  it("derives each cut off from now and the constants", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(cleanupCutoffs(now)).toEqual({
      idleUploadBefore: new Date("2026-11-11T11:30:00Z"), // 15 min link + 15 min margin
      uploadBackstopBefore: new Date("2026-11-11T06:00:00Z"), // 6 hours
      queuedJobBefore: new Date("2026-11-11T11:45:00Z"), // 15 min
      queuedBackstopBefore: new Date("2026-11-11T06:00:00Z"), // 6 hours
      runningJobBefore: new Date("2026-11-11T10:35:00Z"), // 2 attempts x 40 min maxDuration + 5 min margin
      transcribeRunningJobBefore: new Date("2026-11-11T11:10:00Z"), // 3 attempts x 15 min + 5 min margin
    });
  });

  it("keeps process-take to 2 runs per creator, and the queued backstop far past any real wait (HRF-T01)", () => {
    expect(PROCESS_TAKE_LIMITS.perCreatorConcurrency).toBe(2);
    // One creator's queue drains at 2 full runs at a time; the backstop outlasts several of them.
    expect(CLEANUP.queuedBackstopMs).toBeGreaterThan(CLEANUP.jobMaxDurationMs);
    expect(CLEANUP.queuedBackstopMs).toBeGreaterThan(CLEANUP.queuedStaleMs);
    // The lookups of one sweep are bounded well inside the 10 minute cleanup task (about 2 minutes).
    expect(CLEANUP.queuedRunChecksPerSweep * CLEANUP.runCheckTimeoutMs).toBeLessThanOrEqual(
      3 * 60_000,
    );
  });

  it("derives the transcribe window from its own limits (3 attempts, 15 minutes), 50 minutes in all", () => {
    expect(CLEANUP.transcribeJobMaxDurationMs).toBe(
      TRANSCRIBE_TAKE_LIMITS.maxAttempts * TRANSCRIBE_TAKE_LIMITS.maxDurationSeconds * 1000,
    );
    expect(TRANSCRIBE_TAKE_LIMITS).toEqual({ maxDurationSeconds: 15 * 60, maxAttempts: 3 });
    expect(CLEANUP.transcribeJobMaxDurationMs + CLEANUP.runningStaleMarginMs).toBe(50 * 60 * 1000);
    // Shorter than the video window, never shorter than one full run of its own task.
    expect(CLEANUP.transcribeJobMaxDurationMs).toBeLessThan(CLEANUP.jobMaxDurationMs);
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
