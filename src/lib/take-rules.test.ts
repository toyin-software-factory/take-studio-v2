import { describe, expect, it } from "vitest";
import { TAKE_STATUSES, type TakeStatus } from "./processing";
import {
  MEDIA_LIMITS,
  canTransition,
  checkUpload,
  cleanTitle,
  originalKey,
  titleFromFileName,
  videoExpiresAt,
} from "./take-rules";

const good = { durationMs: 61_500, width: 1920, height: 1080, container: "mp4" };

describe("checkUpload (AC-5)", () => {
  it("accepts a file within every limit, landscape or portrait", () => {
    expect(checkUpload(1_000, good)).toEqual({ ok: true, ...good });
    expect(checkUpload(1_000, { ...good, width: 1080, height: 1920, container: "mov" }).ok).toBe(
      true,
    );
    expect(
      checkUpload(MEDIA_LIMITS.maxBytes, { ...good, durationMs: MEDIA_LIMITS.maxDurationMs }).ok,
    ).toBe(true);
  });

  it.each([
    ["over 2 GB", MEDIA_LIMITS.maxBytes + 1, good, "too_large"],
    ["unreadable", 1_000, null, "corrupt_upload"],
    ["over 10 minutes", 1_000, { ...good, durationMs: MEDIA_LIMITS.maxDurationMs + 1 }, "too_long"],
    ["4K", 1_000, { ...good, width: 3840, height: 2160 }, "resolution_exceeded"],
    ["1440 short side", 1_000, { ...good, width: 1920, height: 1440 }, "resolution_exceeded"],
    ["wrong container", 1_000, { ...good, container: "webm" }, "invalid_media"],
    ["zero length", 1_000, { ...good, durationMs: 0 }, "invalid_media"],
  ] as const)("rejects a file %s", (_label, size, probe, code) => {
    expect(checkUpload(size, probe)).toEqual({ ok: false, failureCode: code });
  });
});

describe("take state machine (AC-3)", () => {
  const allowed: ReadonlyArray<readonly [TakeStatus, TakeStatus]> = [
    ["uploading", "uploaded"],
    ["uploading", "failed"],
    ["uploaded", "processing"],
    ["uploaded", "expired"],
    ["uploaded", "failed"],
    ["processing", "ready"],
    ["processing", "failed"],
    ["ready", "processing"],
    ["failed", "processing"],
    ["ready", "expired"],
    ["failed", "expired"],
  ];

  it("allows exactly the transitions in the spec", () => {
    for (const from of TAKE_STATUSES) {
      for (const to of TAKE_STATUSES) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("never leaves expired and never skips processing", () => {
    for (const to of TAKE_STATUSES) expect(canTransition("expired", to)).toBe(false);
    expect(canTransition("uploaded", "ready")).toBe(false);
    expect(canTransition("processing", "expired")).toBe(false);
  });
});

describe("titles and keys", () => {
  it("cleans control characters, whitespace and the video extension", () => {
    expect(cleanTitle("  My\u0000 take\n\t2.MP4 ")).toBe("My take 2");
    expect(cleanTitle(" \u0007")).toBe("");
  });

  it("cuts a file name title to 200 characters", () => {
    const title = titleFromFileName(`${"a".repeat(250)}.mov`);
    expect(title).toHaveLength(200);
  });

  it("builds the original key and the expiry", () => {
    expect(originalKey("t1", "mov")).toBe("originals/t1/source.mov");
    expect(videoExpiresAt(new Date("2026-01-31T12:00:00Z")).toISOString()).toBe(
      "2026-03-02T12:00:00.000Z",
    );
  });
});
