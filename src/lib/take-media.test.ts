import { describe, expect, it } from "vitest";
import {
  chooseMedia,
  downloadFileName,
  isExpired,
  isRetryable,
  removedMs,
  slugify,
  takeNote,
} from "./take-media";

describe("slugify (AC-9 file names, non ASCII titles)", () => {
  it.each([
    ["My first take", "my-first-take"],
    ["Café crème — take 2!", "cafe-creme-take-2"],
    ["Größe & Straße", "grosse-strasse"],
    ["Ærø søndag, Łódź", "aero-sondag-lodz"],
    ["  --Interview: Q&A--  ", "interview-q-a"],
    ["ÉLAN", "elan"],
    ["日本語のテイク", "take"],
    ["🎬🎥", "take"],
    ["", "take"],
    ["   ", "take"],
    ["Take 日本 2", "take-2"],
  ])("%j → %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("caps long titles at 80 characters without a trailing dash", () => {
    const slug = slugify(`${"word ".repeat(40)}end`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).not.toMatch(/-$/);
  });
});

describe("downloadFileName", () => {
  it("names the render and the original", () => {
    expect(downloadFileName("Café take", "render", "mov")).toBe("cafe-take-trimmed.mp4");
    expect(downloadFileName("Café take", "original", "mov")).toBe("cafe-take-original.mov");
    expect(downloadFileName("日本語", "original", "mp4")).toBe("take-original.mp4");
  });
});

describe("isExpired", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  it("is expired by status or once the expiry time passed", () => {
    expect(isExpired({ status: "expired", videoExpiresAt: null }, now)).toBe(true);
    expect(
      isExpired({ status: "ready", videoExpiresAt: new Date("2026-12-01T12:00:00Z") }, now),
    ).toBe(true);
    expect(
      isExpired({ status: "ready", videoExpiresAt: new Date("2026-12-01T12:00:01Z") }, now),
    ).toBe(false);
    expect(isExpired({ status: "uploading", videoExpiresAt: null }, now)).toBe(false);
  });
});

describe("removedMs", () => {
  it("sums ranges and ignores empty or reversed ones", () => {
    expect(removedMs([])).toBe(0);
    expect(
      removedMs([
        { startMs: 1000, endMs: 2400 },
        { startMs: 5000, endMs: 5000 },
        { startMs: 9000, endMs: 8000 },
        { startMs: 10_000, endMs: 10_750 },
      ]),
    ).toBe(2150);
  });
});

describe("takeNote (AC-7)", () => {
  const steps = (trim: string, render: string) => [
    { name: "trim", status: trim },
    { name: "render", status: render },
  ];
  it("reports no audio, no cuts, or nothing", () => {
    expect(takeNote({ status: "succeeded", steps: steps("skipped", "skipped") }, false)).toBe(
      "no_audio",
    );
    expect(takeNote({ status: "succeeded", steps: steps("succeeded", "skipped") }, false)).toBe(
      "no_cuts",
    );
    expect(
      takeNote({ status: "succeeded", steps: steps("succeeded", "succeeded") }, true),
    ).toBeNull();
  });
  it("has no note while running, after a failure or without a job", () => {
    expect(takeNote({ status: "running", steps: steps("succeeded", "running") }, false)).toBeNull();
    expect(takeNote({ status: "failed", steps: steps("succeeded", "failed") }, false)).toBeNull();
    expect(takeNote(null, false)).toBeNull();
  });
});

describe("isRetryable (AC-10, spec 0002)", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const later = new Date("2026-12-20T00:00:00Z");
  it.each([
    ["internal_error", true],
    ["ffmpeg_error", true],
    ["timeout", true],
    ["trigger_failed", true],
    ["cancelled_while_running", true],
    ["some_future_code", true],
    ["invalid_media", false],
    ["too_long", false],
    ["too_large", false],
    ["resolution_exceeded", false],
    ["corrupt_upload", false],
    ["upload_abandoned", false],
  ])("failed with %s on a probed take → %s", (failureCode, retryable) => {
    expect(
      isRetryable(
        { status: "failed", failureCode, durationMs: 60_000, videoExpiresAt: later },
        now,
      ),
    ).toBe(retryable);
  });
  it("needs a failed, probed take", () => {
    const failed = {
      status: "failed",
      failureCode: "internal_error",
      durationMs: 60_000,
      videoExpiresAt: later,
    };
    expect(isRetryable({ ...failed, status: "ready" }, now)).toBe(false);
    expect(isRetryable({ ...failed, durationMs: null }, now)).toBe(false);
  });
  it("is not retryable once the video expired, even before the sweep marks it", () => {
    const failed = {
      status: "failed",
      failureCode: "internal_error",
      durationMs: 60_000,
      videoExpiresAt: later,
    };
    expect(isRetryable({ ...failed, videoExpiresAt: now }, now)).toBe(false);
    expect(isRetryable({ ...failed, videoExpiresAt: new Date(now.getTime() - 1) }, now)).toBe(
      false,
    );
    expect(isRetryable({ ...failed, status: "expired" }, now)).toBe(false);
  });
});

describe("chooseMedia (AC-7, AC-9, AC-12)", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const later = new Date("2026-12-20T00:00:00Z");
  const ready = {
    id: "t",
    status: "ready",
    videoExpiresAt: later,
    originalKey: "originals/t/source.mov",
  };
  const render = { status: "succeeded", videoKey: "renders/t/r.mp4" };

  it("plays and downloads the render, and the original on request", () => {
    expect(chooseMedia("play", ready, render, now)).toEqual({
      ok: true,
      file: "render",
      key: "renders/t/r.mp4",
    });
    expect(chooseMedia("download", ready, render, now)).toEqual({
      ok: true,
      file: "render",
      key: "renders/t/r.mp4",
    });
    expect(chooseMedia("original", ready, render, now)).toEqual({
      ok: true,
      file: "original",
      key: "originals/t/source.mov",
    });
  });

  it("serves the original for play and download when a ready take has no render (AC-7)", () => {
    expect(chooseMedia("download", ready, null, now)).toEqual({
      ok: true,
      file: "original",
      key: "originals/t/source.mov",
    });
    expect(chooseMedia("play", ready, null, now)).toEqual({
      ok: true,
      file: "original",
      key: "originals/t/source.mov",
    });
  });

  it("serves the thumbnail by its derived key once the upload finished", () => {
    expect(chooseMedia("thumb", ready, null, now)).toEqual({
      ok: true,
      file: "thumb",
      key: "originals/t/thumb.jpg",
    });
    expect(chooseMedia("thumb", { ...ready, status: "processing" }, null, now)).toMatchObject({
      ok: true,
      key: "originals/t/thumb.jpg",
    });
    expect(
      chooseMedia("thumb", { ...ready, status: "uploading", videoExpiresAt: null }, null, now),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("is not found while there is no file yet", () => {
    const processing = { ...ready, status: "processing" };
    expect(chooseMedia("download", processing, { status: "pending", videoKey: null }, now)).toEqual(
      { ok: false, error: "not_found" },
    );
    expect(
      chooseMedia("original", { ...ready, status: "uploading", videoExpiresAt: null }, null, now),
    ).toEqual({ ok: false, error: "not_found" });
    expect(chooseMedia("play", { ...ready, originalKey: null }, null, now)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("is gone once expired, whatever the kind (410)", () => {
    for (const kind of ["play", "download", "original", "thumb"] as const) {
      expect(chooseMedia(kind, { ...ready, status: "expired" }, render, now)).toEqual({
        ok: false,
        error: "expired",
      });
      expect(chooseMedia(kind, { ...ready, videoExpiresAt: now }, render, now)).toEqual({
        ok: false,
        error: "expired",
      });
    }
  });
});
