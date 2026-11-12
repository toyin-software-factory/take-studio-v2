import { describe, expect, it } from "vitest";
import {
  PREVIEW_LIMITS,
  PREVIEW_QUEUE_MARGIN_MS,
  PREVIEW_RUN_MS,
  PREVIEW_STALE_MS,
  PREVIEW_WIDTH,
  PREVIEW_STILL_VERSION,
  centreDifferenceShare,
  cutVersion,
  gateReadArgs,
  gateSize,
  isOnlyBackground,
  isStalePreview,
  keyedPreviewGraph,
  plainPreviewFilter,
  previewHeight,
  previewKey,
} from "./background-preview";

describe("preview rules (spec 0008, AC-4)", () => {
  it("names the file from the take and the preview, so it is reachable from its row", () => {
    expect(previewKey("t1", "p1")).toBe("previews/t1/p1.jpg");
  });

  it("gives the same cut version for the same cuts in any order, and a new one when they change", async () => {
    const a = await cutVersion([
      { startMs: 1000, endMs: 2000 },
      { startMs: 4000, endMs: 5000 },
    ]);
    const reordered = await cutVersion([
      { startMs: 4000, endMs: 5000 },
      { startMs: 1000, endMs: 2000 },
    ]);
    expect(a).toBe(reordered);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await cutVersion([{ startMs: 1000, endMs: 2001 }])).not.toBe(
      await cutVersion([{ startMs: 1000, endMs: 2000 }]),
    );
    // No cuts is a version of its own.
    const none = await cutVersion([]);
    expect(none).toMatch(/^[0-9a-f]{16}$/);
    expect(none).not.toBe(a);
  });

  it("includes the still version, so a keying change makes every cached preview miss (S3S-T10)", async () => {
    expect(PREVIEW_STILL_VERSION).toBeGreaterThanOrEqual(3);
    // The version 1 identity of "no cuts" (what a still made before S3S-T10 was stored under).
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(""));
    const oldNone = [...new Uint8Array(digest).slice(0, 8)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(await cutVersion([])).not.toBe(oldNone);
  });

  it("derives the stale threshold from the job's limits: every attempt plus a queue margin", () => {
    expect(PREVIEW_LIMITS).toEqual({ maxDurationSeconds: 180, maxAttempts: 2 });
    expect(PREVIEW_RUN_MS).toBe(
      PREVIEW_LIMITS.maxDurationSeconds * PREVIEW_LIMITS.maxAttempts * 1000,
    );
    expect(PREVIEW_STALE_MS).toBe(PREVIEW_RUN_MS + PREVIEW_QUEUE_MARGIN_MS);
    // 2 x 180 s + 2 min = 8 minutes; it can never be shorter than one full run of the job.
    expect(PREVIEW_STALE_MS).toBe(480_000);
    expect(PREVIEW_STALE_MS).toBeGreaterThan(PREVIEW_RUN_MS);
  });

  it("calls a making preview stale only after the derived threshold", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    // A run on its second attempt, 5 minutes in, is still running: not stale.
    expect(isStalePreview(ago(5 * 60_000), now)).toBe(false);
    expect(isStalePreview(ago(PREVIEW_RUN_MS), now)).toBe(false);
    expect(isStalePreview(ago(PREVIEW_STALE_MS), now)).toBe(false);
    expect(isStalePreview(ago(PREVIEW_STALE_MS + 1_000), now)).toBe(true);
  });

  it("sizes the still at 1280 wide, with an even height for the take's own shape", () => {
    expect(PREVIEW_WIDTH).toBe(1280);
    expect(previewHeight(1920, 1080)).toBe(720);
    expect(previewHeight(1080, 1920)).toBe(2276);
    expect(previewHeight(1000, 1001) % 2).toBe(0);
  });

  it("builds the keyed graph with the render's chain, tone mapping HDR first", () => {
    const sdr = keyedPreviewGraph({
      keyColor: "#00b140",
      takeWidth: 1920,
      takeHeight: 1080,
      toneMap: null,
    }).split("\n");
    expect(sdr[0]).toBe("[0:v]scale=1280:720[base];");
    expect(sdr[1]).toContain("chromakey=0x00b140:0.12:0.08,despill=type=green[fg];");
    expect(sdr[2]).toContain(
      "scale=1280:720:force_original_aspect_ratio=increase:out_range=tv,crop=1280:720",
    );
    expect(sdr[3]).toBe("[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[vout]");
    const hdr = keyedPreviewGraph({
      keyColor: "#00b140",
      takeWidth: 1920,
      takeHeight: 1080,
      toneMap: "TONEMAP",
    });
    expect(hdr.startsWith("[0:v]TONEMAP,scale=1280:720[base];")).toBe(true);
  });

  it("builds the plain filter for a take with no green screen", () => {
    expect(plainPreviewFilter({ takeWidth: 1920, takeHeight: 1080, toneMap: null })).toBe(
      "scale=1280:720,format=yuvj420p",
    );
    expect(plainPreviewFilter({ takeWidth: 1920, takeHeight: 1080, toneMap: "TM" })).toBe(
      "TM,scale=1280:720,format=yuvj420p",
    );
  });
});

describe("the final gate (S3S-T12)", () => {
  const frame = (w: number, h: number, paint: (x: number, y: number) => number[]) => {
    const data = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 3);
    return { width: w, height: h, data };
  };
  const bg = frame(30, 12, () => [90, 60, 40]);

  it("sees an identical still (or one with only JPEG noise) as only the background", () => {
    const noisy = frame(30, 12, (x, y) => [90 + ((x + y) % 5), 60, 40 - ((x * y) % 4)]);
    expect(centreDifferenceShare(bg, bg)).toBe(0);
    expect(centreDifferenceShare(noisy, bg)).toBe(0);
    expect(isOnlyBackground(centreDifferenceShare(noisy, bg))).toBe(true);
  });

  it("does not trip on a still with a person in the centre, large or small", () => {
    const person = (half: number) =>
      frame(30, 12, (x) => (Math.abs(x - 15) < half ? [120, 120, 125] : [90, 60, 40]));
    // a head and shoulders fill most of the centre third; a distant one a small part of it
    expect(centreDifferenceShare(person(5), bg)).toBeGreaterThanOrEqual(0.9);
    expect(isOnlyBackground(centreDifferenceShare(person(1), bg))).toBe(false);
  });

  it("counts a difference only above 30 of 255 in some channel, in the middle third only", () => {
    const small = frame(30, 12, (x) => (x >= 10 && x < 20 ? [90, 60, 70] : [90, 60, 40])); // blue +30
    const over = frame(30, 12, (x) => (x >= 10 && x < 20 ? [90, 60, 71] : [90, 60, 40])); // blue +31
    const edges = frame(30, 12, (x) => (x < 10 || x >= 20 ? [255, 0, 0] : [90, 60, 40]));
    expect(centreDifferenceShare(small, bg)).toBe(0);
    expect(centreDifferenceShare(over, bg)).toBe(1);
    expect(centreDifferenceShare(edges, bg)).toBe(0);
  });

  it("treats frames of different sizes as different, so it never keeps a bad comparison silently wrong", () => {
    expect(
      centreDifferenceShare(
        bg,
        frame(30, 10, () => [0, 0, 0]),
      ),
    ).toBe(1);
  });

  it("reads both images at 192 wide with an even height, the background covered and cropped", () => {
    expect(gateSize(1920, 1080)).toEqual({ width: 192, height: 108 });
    expect(gateSize(1080, 1920)).toEqual({ width: 192, height: 342 });
    const size = gateSize(1920, 1080);
    expect(
      gateReadArgs("bg.jpg", size, { width: 1280, height: 720 }, ["-reconnect", "1"]).join(" "),
    ).toContain(
      "scale=1280:720:force_original_aspect_ratio=increase:out_range=tv,crop=1280:720,setsar=1,format=yuv420p,scale=192:108,format=rgb24",
    );
    expect(gateReadArgs("still.jpg", size, null).join(" ")).toContain("scale=192:108,format=rgb24");
  });
});
