import type { FailureCode } from "./failure-codes";
import { CONTAINERS, type Container, TAKE_TITLE_MAX, type TakeStatus } from "./processing";

/**
 * Pure rules for takes (spec 0002): media limits (AC-5), allowed status transitions (AC-3),
 * title clean up, and the original upload key. No I/O here.
 */

/** Media limits for an upload (AC-5). One place to change them. */
export const MEDIA_LIMITS = {
  /** 10 minutes. */
  maxDurationMs: 10 * 60 * 1000,
  /** 2 GB, as 2 GiB. */
  maxBytes: 2 * 1024 ** 3,
  /** 1080p in either orientation: long side ≤ 1920, short side ≤ 1080. */
  maxLongSide: 1920,
  maxShortSide: 1080,
} as const;

/** Days an uploaded video is kept, from upload completion (never extended). */
export const VIDEO_RETENTION_DAYS = 30;

/** What the probe task found in the uploaded file. */
export type Probe = {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  /** Normalised container name (`mp4`, `mov` or `webm` when acceptable). */
  readonly container: string;
};

export type ProbeVerdict =
  | {
      readonly ok: true;
      readonly durationMs: number;
      readonly width: number;
      readonly height: number;
      readonly container: Container;
    }
  | { readonly ok: false; readonly failureCode: FailureCode };

function isContainer(value: string): value is Container {
  return (CONTAINERS as readonly string[]).includes(value);
}

/**
 * Checks the stored size and the probe against the limits (AC-5). `probe` is null when
 * the file could not be read at all. Checks run cheapest and most certain first.
 */
export function checkUpload(sizeBytes: number, probe: Probe | null): ProbeVerdict {
  if (sizeBytes > MEDIA_LIMITS.maxBytes) return { ok: false, failureCode: "too_large" };
  if (probe === null) return { ok: false, failureCode: "corrupt_upload" };

  const { durationMs, width, height, container } = probe;
  const sane = [durationMs, width, height].every((n) => Number.isInteger(n) && n > 0);
  if (!sane || !isContainer(container)) return { ok: false, failureCode: "invalid_media" };
  if (durationMs > MEDIA_LIMITS.maxDurationMs) return { ok: false, failureCode: "too_long" };

  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (longSide > MEDIA_LIMITS.maxLongSide || shortSide > MEDIA_LIMITS.maxShortSide) {
    return { ok: false, failureCode: "resolution_exceeded" };
  }
  return { ok: true, durationMs, width, height, container };
}

/** Allowed take status transitions (spec 0002, "State transitions"). */
export const TAKE_TRANSITIONS: Readonly<Record<TakeStatus, readonly TakeStatus[]>> = {
  uploading: ["uploaded", "failed"],
  // `failed` when processing never got started (probe gave up after the upload was fine).
  uploaded: ["processing", "expired", "failed"],
  processing: ["ready", "failed"],
  ready: ["processing", "expired"],
  failed: ["processing", "expired"],
  expired: [],
};

export function canTransition(from: TakeStatus, to: TakeStatus): boolean {
  return TAKE_TRANSITIONS[from].includes(to);
}

// Control characters (C0, DEL, C1) and Unicode line/paragraph separators.
const UNSAFE_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");

/**
 * Cleans a title: drops control characters, collapses whitespace, trims, and removes a
 * trailing `.mp4` / `.mov` / `.webm` (titles come from file names). May return an empty string.
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(UNSAFE_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(mp4|mov|webm)$/i, "")
    .trim();
}

/** Title from an upload file name: cleaned and cut to the maximum length. */
export function titleFromFileName(fileName: string): string {
  return [...cleanTitle(fileName)].slice(0, TAKE_TITLE_MAX).join("").trim();
}

/** Original upload key (spec 0001 prefixes): `originals/{takeId}/source.{container}`. */
export function originalKey(takeId: string, container: Container): string {
  return `originals/${takeId}/source.${container}`;
}

/** Thumbnail key (spec 0004): `originals/{takeId}/thumb.jpg`, written by the probe. */
export function thumbnailKey(takeId: string): string {
  return `originals/${takeId}/thumb.jpg`;
}

/** When an uploaded video expires: completion time + retention days. */
export function videoExpiresAt(uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
