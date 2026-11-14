import { describe, expect, it } from "vitest";
import {
  RECORDER,
  shouldAutoStop,
  baseType,
  classifyMediaError,
  isLongEnough,
  pickMimeType,
  recordingFileName,
  recordingLimitMs,
  scrollFraction,
  isUsedUp,
  shouldWarn,
  usageLimitSeconds,
  wordCount,
} from "./recorder-rules";

const supports =
  (...types: string[]) =>
  (t: string) =>
    types.includes(t);

describe("pickMimeType (AC-4)", () => {
  it("prefers MP4 with H.264 and AAC when the browser can (Safari)", () => {
    const picked = pickMimeType(supports("video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"));
    expect(picked).toEqual({
      mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      container: "mp4",
    });
  });

  it("takes plain MP4 over WebM when only that MP4 form works", () => {
    expect(pickMimeType(supports("video/mp4", "video/webm"))?.container).toBe("mp4");
  });

  it("falls to WebM VP9 then VP8 (Chrome, Firefox)", () => {
    expect(pickMimeType(supports("video/webm;codecs=vp9,opus", "video/webm"))?.mimeType).toBe(
      "video/webm;codecs=vp9,opus",
    );
    expect(pickMimeType(supports("video/webm;codecs=vp8,opus"))?.container).toBe("webm");
  });

  it("returns null when nothing is supported", () => {
    expect(pickMimeType(supports())).toBeNull();
  });

  it("strips the codec list for the file type", () => {
    expect(baseType("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(baseType("video/mp4")).toBe("video/mp4");
  });
});

describe("recordingFileName", () => {
  it("uses the device clock with zero padding", () => {
    expect(recordingFileName(new Date(2026, 10, 4, 9, 5), "mp4")).toBe(
      "Recording 2026-11-04 09.05.mp4",
    );
    expect(recordingFileName(new Date(2026, 10, 14, 13, 48), "webm")).toBe(
      "Recording 2026-11-14 13.48.webm",
    );
  });
});

describe("recordingLimitMs", () => {
  it("is the 10 minute cap with no usage", () => {
    expect(recordingLimitMs(null)).toBe(600_000);
  });
  it("is the allowance left when that is lower, never negative", () => {
    expect(recordingLimitMs(90)).toBe(90_000);
    expect(recordingLimitMs(5000)).toBe(600_000);
    expect(recordingLimitMs(-4)).toBe(0);
  });
});

describe("usage and the length limit (AC-6)", () => {
  it("only caps the recording when the limit is on", () => {
    expect(usageLimitSeconds(null)).toBeNull();
    expect(usageLimitSeconds({ enforced: false, remainingSeconds: 30 })).toBeNull();
    expect(usageLimitSeconds({ enforced: true, remainingSeconds: 90 })).toBe(90);
    expect(usageLimitSeconds({ enforced: true, remainingSeconds: -5 })).toBe(0);
  });
  it("is used up only with the limit on and nothing left", () => {
    expect(isUsedUp({ enforced: true, remainingSeconds: 0 })).toBe(true);
    expect(isUsedUp({ enforced: true, remainingSeconds: 1 })).toBe(false);
    expect(isUsedUp({ enforced: false, remainingSeconds: 0 })).toBe(false);
    expect(isUsedUp(null)).toBe(false);
  });
  it("the allowance left shortens the limit under 10 minutes", () => {
    expect(recordingLimitMs(usageLimitSeconds({ enforced: true, remainingSeconds: 120 }))).toBe(
      120_000,
    );
  });
  it("warns 60 seconds before the stop, and at once for a limit under a minute", () => {
    expect(shouldWarn(539_000, 600_000)).toBe(false);
    expect(shouldWarn(540_000, 600_000)).toBe(true);
    expect(shouldWarn(0, 45_000)).toBe(true);
  });
});

describe("classifyMediaError (AC-5)", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["NotFoundError", "unavailable"],
    ["NotReadableError", "in_use"],
    ["TypeError", "unsupported"],
    ["SomethingNew", "unavailable"],
  ])("%s is %s", (name, failure) => {
    expect(classifyMediaError(name)).toBe(failure);
  });
});

describe("scroll and length", () => {
  it("counts words", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  one two\nthree ")).toBe(3);
  });
  it("scrolls linearly and clamps", () => {
    // 140 words at 140 wpm is one minute.
    expect(scrollFraction(30_000, 140)).toBeCloseTo(0.5);
    expect(scrollFraction(120_000, 140)).toBe(1);
    expect(scrollFraction(-5, 140)).toBe(0);
    expect(scrollFraction(10_000, 0)).toBe(0);
  });
  it("needs a second to count as a take", () => {
    expect(isLongEnough(999)).toBe(false);
    expect(isLongEnough(1000)).toBe(true);
  });
});

describe("shouldAutoStop", () => {
  it("stops a margin before the limit so the file stays under it", () => {
    const limit = 600_000;
    expect(shouldAutoStop(limit - RECORDER.stopMarginMs - 1, limit)).toBe(false);
    expect(shouldAutoStop(limit - RECORDER.stopMarginMs, limit)).toBe(true);
    expect(shouldAutoStop(limit, limit)).toBe(true);
  });
});
