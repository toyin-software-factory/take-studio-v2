import { describe, expect, it } from "vitest";
import { isMediaFailure } from "./failure-codes";
import {
  POLL,
  keepPolling,
  effectiveStatus,
  expiryNote,
  shortDate,
  failureMessage,
  formatClock,
  isInFlight,
  backgroundChangeActive,
  backgroundFailureMessage,
  overallPercent,
  pollDelay,
  previewStatusText,
  removedNote,
  stepStatusText,
  tabTitle,
} from "./take-display";
import { takeReadyEmail } from "./email/templates";

const emailBase = {
  title: "Demo",
  takeUrl: "https://app.example.com/takes/1",
  unsubscribeUrl: "https://app.example.com/emails/off?u=1&s=2",
};

describe("formatClock (design.md Voice: mm:ss, h:mm:ss from an hour)", () => {
  it.each([
    [0, "0:00"],
    [null, "0:00"],
    [-5, "0:00"],
    [2_499, "0:02"],
    [2_500, "0:02"],
    [2_501, "0:02"],
    [4_999, "0:04"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [84_000, "1:24"],
    [600_000, "10:00"],
    [3_723_000, "1:02:03"],
  ])("%s ms → %s", (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });

  it("shows the removed time the same way in the take page note and in the email", () => {
    for (const ms of [2_499, 2_500, 2_501, 59_999, 60_000]) {
      const clock = formatClock(ms);
      expect(removedNote(ms)).toBe(`Removed ${clock} of pauses`);
      expect(takeReadyEmail({ ...emailBase, removedMs: ms, note: null }).text).toContain(
        `We removed ${clock} of pauses.`,
      );
    }
  });

  it("writes the AC-9 note", () => {
    expect(removedNote(84_400)).toBe("Removed 1:24 of pauses");
  });
});

describe("expiryNote (AC-1)", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  it.each([
    ["2026-11-23T13:00:00Z", false, "Video expires in 12 days"],
    ["2026-11-12T13:00:00Z", false, "Video expires in 1 day"],
    ["2026-11-11T18:00:00Z", false, "Video expires in less than a day"],
    ["2026-11-12T10:00:00Z", false, "Video expires in less than a day"],
    ["2026-11-10T09:00:00Z", false, "Video expired on 10 Nov"],
    ["2026-12-03T09:00:00Z", true, "Video expired on 3 Dec"],
  ])("%s (expired %s) → %s", (at, expired, text) => {
    expect(expiryNote(at, expired, now)).toBe(text);
  });

  it("has no note before the upload completes", () => {
    expect(expiryNote(null, false, now)).toBeNull();
  });
});

describe("overallPercent (spec 0012: trim 10, transcript 5, AI edit 5, background 5, render 75, of the steps the job has)", () => {
  const step = (name: string, status: string, progress: number | null = null) => ({
    name,
    status,
    progress,
  });

  it.each([
    [[step("trim", "pending"), step("render", "pending")], 0],
    [[step("trim", "running", 50), step("render", "pending")], 5],
    [[step("trim", "succeeded"), step("render", "running", 50)], 55],
    // With a background the bar has three steps: 10 + 5 + 75.
    [[step("trim", "succeeded"), step("background", "running", 0), step("render", "pending")], 11],
    [
      [step("trim", "succeeded"), step("background", "succeeded"), step("render", "running", 50)],
      58,
    ],
    // The transcript step weighs 5; a failed one is over, like a skipped one.
    [[step("trim", "succeeded"), step("transcript", "running", 40), step("render", "pending")], 13],
    [[step("trim", "succeeded"), step("transcript", "failed"), step("render", "pending")], 16],
    [[step("trim", "skipped"), step("render", "skipped")], 100],
    [[step("trim", "succeeded"), step("render", "succeeded")], 100],
  ])("%j → %i", (steps, percent) => {
    expect(overallPercent(steps)).toBe(percent);
  });

  it("shows a running step's percent, else its status word", () => {
    expect(stepStatusText(step("render", "running", 42))).toBe("42%");
    expect(stepStatusText(step("render", "running"))).toBe("In progress");
    expect(stepStatusText(step("trim", "skipped"))).toBe("Skipped");
    // A failed step of a job that goes on is a quiet "Skipped" (spec 0012).
    expect(stepStatusText(step("transcript", "failed"))).toBe("Skipped");
    expect(stepStatusText(step("transcript", "failed"), { jobFailed: true })).toBe("Failed");
  });
});

describe("failures (AC-4, AC-10)", () => {
  it("names the limit for media failures", () => {
    expect(failureMessage({ failureCode: "too_long", durationMs: 14 * 60_000 })).toBe(
      "This video is 14 minutes long. The limit is 10 minutes.",
    );
    expect(isMediaFailure("too_long")).toBe(true);
  });

  it("says our failures weren't the creator's fault", () => {
    expect(failureMessage({ failureCode: "ffmpeg_error", durationMs: 1000 })).toMatch(
      /on our side/,
    );
    expect(isMediaFailure("ffmpeg_error")).toBe(false);
    expect(isMediaFailure(null)).toBe(false);
  });
});

describe("tab titles and polling (AC-8, Flow step 7)", () => {
  it("prefixes the status", () => {
    expect(tabTitle("processing", "My take")).toBe("Processing… · My take · Take Studio");
    expect(tabTitle("ready", "My take")).toBe("Ready · My take · Take Studio");
  });

  it("keeps checking only while a take is moving", () => {
    expect(["uploading", "uploaded", "processing"].every(isInFlight)).toBe(true);
    expect(["ready", "failed", "expired"].some(isInFlight)).toBe(false);
  });

  it("backs off from 2 s to at most 10 s", () => {
    expect([0, 1, 2, 3].map((n) => pollDelay(2000, n))).toEqual([2000, 4000, 8000, 10_000]);
  });
});

describe("shortDate", () => {
  it("shows the UTC date whatever the host time zone", () => {
    expect(shortDate("2026-12-03T00:30:00Z")).toBe("3 Dec");
  });
});

describe("effectiveStatus", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  it("turns a ready take into expired once its time has passed or the server says so", () => {
    expect(effectiveStatus("ready", "2026-11-11T11:59:00Z", false, now)).toBe("expired");
    expect(effectiveStatus("ready", "2026-12-01T00:00:00Z", true, now)).toBe("expired");
  });
  it("leaves other takes alone", () => {
    expect(effectiveStatus("ready", "2026-12-01T00:00:00Z", false, now)).toBe("ready");
    expect(effectiveStatus("failed", "2026-11-01T00:00:00Z", false, now)).toBe("failed");
    expect(effectiveStatus("ready", null, false, now)).toBe("ready");
  });
});

describe("failureMessage when the take can't be retried", () => {
  it("says to upload again instead of try again", () => {
    const take = { failureCode: "internal_error", durationMs: null };
    expect(failureMessage(take, false)).toMatch(/Upload the video again\.$/);
    expect(failureMessage(take)).toMatch(/Try again\.$/);
  });
});

describe("background change helpers (spec 0008)", () => {
  it("is active only while queued or running", () => {
    expect(backgroundChangeActive({ status: "queued" })).toBe(true);
    expect(backgroundChangeActive({ status: "running" })).toBe(true);
    expect(backgroundChangeActive({ status: "succeeded" })).toBe(false);
    expect(backgroundChangeActive({ status: "failed" })).toBe(false);
    expect(backgroundChangeActive(null)).toBe(false);
    expect(backgroundChangeActive(undefined)).toBe(false);
  });

  it("explains a failed change, with a special word for a vanished background", () => {
    expect(backgroundFailureMessage("background_missing")).toContain("isn't available any more");
    expect(backgroundFailureMessage("ffmpeg_error")).toContain("Your video is unchanged");
    expect(backgroundFailureMessage(null)).toContain("Try again");
  });
});

describe("keepPolling (S3S-T13)", () => {
  const take = (status: string, expired = false) => ({ status, expired });
  it("keeps going while the take is in flight or a background change runs", () => {
    expect(keepPolling({ take: take("processing") })).toBe(true);
    expect(keepPolling({ take: take("ready"), backgroundJob: { status: "running" } })).toBe(true);
  });
  it("keeps checking a ready take, slowly, so a second tab sees a change made elsewhere", () => {
    expect(keepPolling({ take: take("ready"), backgroundJob: { status: "succeeded" } })).toBe(true);
    expect(POLL.idleMs).toBeGreaterThan(POLL.takeMs);
  });
  it("stops for a failed or expired take", () => {
    expect(keepPolling({ take: take("failed") })).toBe(false);
    expect(keepPolling({ take: take("ready", true) })).toBe(false);
    expect(keepPolling({ take: take("expired") })).toBe(false);
  });
});

describe("pollDelay keeps the idle interval (S3S-T13)", () => {
  it("does not cap a base above the backoff cap", () => {
    expect(pollDelay(POLL.idleMs, 0)).toBe(POLL.idleMs);
    expect(pollDelay(POLL.idleMs, 3)).toBe(POLL.idleMs);
  });
  it("still doubles the 2 s base up to 10 s", () => {
    expect(pollDelay(POLL.takeMs, 0)).toBe(2000);
    expect(pollDelay(POLL.takeMs, 1)).toBe(4000);
    expect(pollDelay(POLL.takeMs, 5)).toBe(POLL.maxBackoffMs);
  });
});

describe("previewStatusText (S3S-T14)", () => {
  it("says a still image is not a video and names Render", () => {
    expect(previewStatusText({ kind: "image" })).toBe(
      "Still preview, not a video. Press “Render” to make it.",
    );
  });
  it("says the video is paused while the still is made", () => {
    expect(previewStatusText({ kind: "making" })).toBe(
      "Making a still preview. Your video is paused.",
    );
  });
});

describe("failureMessage limit_exceeded (spec 0014 AC-6)", () => {
  it("says the allowance is used up and the upload is kept, never 'something went wrong'", async () => {
    const { failureMessage } = await import("./take-display");
    const text = failureMessage({ failureCode: "limit_exceeded", durationMs: 30_000 });
    expect(text).toContain("allowance is used up");
    expect(text).not.toContain("went wrong");
  });

  it("does not promise a retry when the take can't be retried", async () => {
    const { failureMessage } = await import("./take-display");
    const text = failureMessage({ failureCode: "limit_exceeded", durationMs: null }, false);
    expect(text).toContain("can't be tried again");
    expect(text).toContain("Upload the video again");
    expect(text).not.toContain("Your upload is kept");
  });
});
