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

describe("isRetryable (AC-10)", () => {
  it.each([
    ["internal_error", true],
    ["ffmpeg_error", true],
    ["timeout", true],
    ["trigger_failed", true],
    ["too_long", false],
    ["corrupt_upload", false],
    ["invalid_media", false],
    ["upload_abandoned", false],
    ["some_future_code", false],
  ])("failed with %s → %s", (failureCode, retryable) => {
    expect(isRetryable({ status: "failed", failureCode })).toBe(retryable);
  });
  it("is never retryable unless failed", () => {
    expect(isRetryable({ status: "ready", failureCode: "internal_error" })).toBe(false);
    expect(isRetryable({ status: "failed", failureCode: null })).toBe(false);
  });
});

describe("chooseMedia (AC-7, AC-9, AC-12)", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const later = new Date("2026-12-20T00:00:00Z");
  const ready = { status: "ready", videoExpiresAt: later, originalKey: "originals/t/source.mov" };
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
    for (const kind of ["play", "download", "original"] as const) {
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
