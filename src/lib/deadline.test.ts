import { describe, expect, it } from "vitest";
import {
  DEADLINE_MARGIN_SECONDS,
  DeadlineExceeded,
  deadlineMs,
  isDeadlineExceeded,
  runWithDeadline,
} from "./deadline";

describe("deadlineMs", () => {
  it("stops 90 s before maxDuration, leaving the failure hooks room", () => {
    expect(DEADLINE_MARGIN_SECONDS).toBe(90);
    expect(deadlineMs(15 * 60)).toBe(13.5 * 60_000);
    expect(deadlineMs(40 * 60)).toBe(38.5 * 60_000);
    expect(deadlineMs(30)).toBe(1000);
  });
});

describe("runWithDeadline (S2T-T07)", () => {
  it("returns the result and rethrows the error of work that finishes in time", async () => {
    expect(await runWithDeadline(1000, async () => 7)).toBe(7);
    await expect(
      runWithDeadline(1000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("aborts the signal, waits for the work to clean up, then throws DeadlineExceeded", async () => {
    const events: string[] = [];
    const error = await runWithDeadline(20, async (signal) => {
      try {
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 30));
        events.push("cleaned up");
      }
    }).catch((e: unknown) => e);
    events.push("thrown");
    expect(error).toBeInstanceOf(DeadlineExceeded);
    expect(isDeadlineExceeded(error)).toBe(true);
    // The cleanup finished before the error reached the caller.
    expect(events).toEqual(["cleaned up", "thrown"]);
  });

  it("throws DeadlineExceeded whatever the aborted work throws", async () => {
    const error = await runWithDeadline(10, async (signal) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      throw new Error("tool failed while stopping");
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeadlineExceeded);
  });

  it("does not wait forever for work that ignores the signal", async () => {
    const started = Date.now();
    const error = await runWithDeadline(10, () => new Promise(() => undefined), {
      windDownMs: 30,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeadlineExceeded);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("is not triggered by work that finishes before the deadline", async () => {
    await runWithDeadline(50, async () => "fast");
    await new Promise((resolve) => setTimeout(resolve, 80));
    // (no unhandled rejection or late abort: the timers were cleared)
  });
});
