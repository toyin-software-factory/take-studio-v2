import { describe, expect, it } from "vitest";
import {
  expiryNote,
  shortDate,
  failureMessage,
  formatClock,
  isInFlight,
  isMediaFailure,
  overallPercent,
  pollDelay,
  removedNote,
  stepStatusText,
  tabTitle,
} from "./take-display";

describe("formatClock (design.md Voice: mm:ss, h:mm:ss from an hour)", () => {
  it.each([
    [0, "0:00"],
    [null, "0:00"],
    [-5, "0:00"],
    [4_999, "0:04"],
    [84_000, "1:24"],
    [600_000, "10:00"],
    [3_723_000, "1:02:03"],
  ])("%s ms → %s", (ms, text) => {
    expect(formatClock(ms)).toBe(text);
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
    ["2026-11-11T18:00:00Z", false, "Video expires today"],
    ["2026-11-12T10:00:00Z", false, "Video expires tomorrow"],
    ["2026-11-10T09:00:00Z", false, "Video expired on 10 Nov"],
    ["2026-12-03T09:00:00Z", true, "Video expired on 3 Dec"],
  ])("%s (expired %s) → %s", (at, expired, text) => {
    expect(expiryNote(at, expired, now)).toBe(text);
  });

  it("has no note before the upload completes", () => {
    expect(expiryNote(null, false, now)).toBeNull();
  });
});

describe("overallPercent (AC-8: trim 10 %, render 90 %)", () => {
  const step = (name: string, status: string, progress: number | null = null) => ({
    name,
    status,
    progress,
  });

  it.each([
    [[step("trim", "pending"), step("render", "pending")], 0],
    [[step("trim", "running", 50), step("render", "pending")], 5],
    [[step("trim", "succeeded"), step("render", "running", 50)], 55],
    [[step("trim", "skipped"), step("render", "skipped")], 100],
    [[step("trim", "succeeded"), step("render", "succeeded")], 100],
  ])("%j → %i", (steps, percent) => {
    expect(overallPercent(steps)).toBe(percent);
  });

  it("shows a running step's percent, else its status word", () => {
    expect(stepStatusText(step("render", "running", 42))).toBe("42%");
    expect(stepStatusText(step("render", "running"))).toBe("In progress");
    expect(stepStatusText(step("trim", "skipped"))).toBe("Skipped");
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
