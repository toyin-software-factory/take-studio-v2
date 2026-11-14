import { describe, expect, it } from "vitest";
import { checkFile, partRange, retryDelayMs, uploadPercent } from "./upload-rules";

const GB2 = 2 * 1024 ** 3;

describe("checkFile (AC-2: refused in the browser before upload)", () => {
  it.each([
    ["take.mp4", "video/mp4", "mp4"],
    ["take.MOV", "video/quicktime", "mov"],
    ["take.mov", "", "mov"],
    ["take.mp4", "", "mp4"],
    // AC-2 accepts either video MIME with a valid extension; the MIME names the container.
    ["take.mov", "video/mp4", "mp4"],
    // Spec 0021: a browser recording is WebM, with or without a codecs suffix on the MIME.
    ["take.webm", "video/webm", "webm"],
    ["take.webm", "video/webm;codecs=vp9,opus", "webm"],
    ["take.WEBM", "", "webm"],
  ])("accepts %s (%s)", (name, type, container) => {
    expect(checkFile({ name, size: 1000, type })).toEqual({ ok: true, container });
  });

  it.each([
    ["take.mkv", ""],
    ["take", ""],
    ["photo.jpg", "image/jpeg"],
  ])("refuses %s (%s) with a friendly message", (name, type) => {
    const check = checkFile({ name, size: 1000, type });
    expect(check).toEqual({
      ok: false,
      message: "This file isn't an MP4 or MOV video. Choose an MP4 or MOV.",
    });
  });

  it("accepts exactly 2 GB and refuses one byte more", () => {
    expect(checkFile({ name: "a.mp4", size: GB2, type: "video/mp4" }).ok).toBe(true);
    expect(checkFile({ name: "a.mp4", size: GB2 + 1, type: "video/mp4" })).toEqual({
      ok: false,
      message: "This video is over 2 GB. The limit is 2 GB.",
    });
  });

  it("refuses an empty file", () => {
    expect(checkFile({ name: "a.mp4", size: 0, type: "video/mp4" }).ok).toBe(false);
  });
});

describe("part maths (AC-3)", () => {
  it("cuts equal parts with a smaller last one", () => {
    expect(partRange(1, 40, 16)).toEqual({ start: 0, end: 16 });
    expect(partRange(2, 40, 16)).toEqual({ start: 16, end: 32 });
    expect(partRange(3, 40, 16)).toEqual({ start: 32, end: 40 });
  });

  it("backs off 1, 2, 4 s, capped at 8 s", () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("reports whole percents from bytes sent per part", () => {
    expect(uploadPercent([16, 8, 0], 40)).toBe(60);
    expect(uploadPercent([16, 16, 8], 40)).toBe(100);
    expect(uploadPercent([], 0)).toBe(0);
  });
});
