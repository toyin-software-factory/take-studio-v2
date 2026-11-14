import { describe, expect, it } from "vitest";
import {
  baseType,
  classifyMediaError,
  isLongEnough,
  pickMimeType,
  recordingFileName,
  recordingLimitMs,
  scrollFraction,
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
