import { describe, expect, it } from "vitest";
import { CLEANUP, cleanupCutoffs } from "./cleanup-rules";

describe("cleanup cut offs (AC-18)", () => {
  it("derives each cut off from now and the constants", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(cleanupCutoffs(now)).toEqual({
      abandonedUploadBefore: new Date("2026-11-11T10:45:00Z"), // 60 min link + 15 min margin
      queuedJobBefore: new Date("2026-11-11T11:45:00Z"), // 15 min
      runningJobBefore: new Date("2026-11-11T11:25:00Z"), // 30 min maxDuration + 5 min margin
    });
  });

  it("matches the processing task's maxDuration in trigger.config.ts (1800 s)", () => {
    expect(CLEANUP.jobMaxDurationMs).toBe(1800 * 1000);
  });
});
