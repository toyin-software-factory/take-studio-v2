import { isMediaFailure } from "./failure-codes";
import { isVideoExpired } from "./video-expiry";

/**
 * Pure rules behind the take routes (spec 0004 API surface, AC-7, AC-9, AC-10, AC-12):
 * download file names, expiry, "Removed m:ss", the AC-7 note, retryability and which stored
 * file each media kind serves. No I/O, so they are unit tested on their own.
 */

/** Longest slug before the `-trimmed.mp4` / `-original.<ext>` suffix. */
const MAX_SLUG_LENGTH = 80;

/**
 * A file name safe slug of a take title: accents folded to ASCII (`Café` → `cafe`), anything
 * else that isn't a letter or digit becomes `-`, lower case, at most 80 characters. A title
 * with nothing usable (empty, emoji, or a script with no ASCII form) gives `take`.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[æÆ]/g, "ae")
    .replace(/[øØ]/g, "o")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "take";
}

export type MediaKind = "play" | "download" | "original" | "thumb";
export const MEDIA_KINDS: readonly MediaKind[] = ["play", "download", "original", "thumb"];

/** Where the probe writes a take's thumbnail (spec 0004, Data model): derived, never stored. */
export function thumbKey(takeId: string): string {
  return `originals/${takeId}/thumb.jpg`;
}

/** Download names (AC-9): `<slug>-trimmed.mp4`, or `<slug>-original.<ext>`. */
export function downloadFileName(
  title: string,
  file: "render" | "original",
  container: string,
): string {
  return file === "render"
    ? `${slugify(title)}-trimmed.mp4`
    : `${slugify(title)}-original.${container}`;
}

/** True once the take's video files are gone or due to go (the sweep may lag 15 minutes). */
export function isExpired(
  take: { readonly status: string; readonly videoExpiresAt: Date | null },
  now: Date,
): boolean {
  return take.status === "expired" || isVideoExpired(take.videoExpiresAt, now);
}

type Range = { readonly startMs: number; readonly endMs: number };

/** Milliseconds removed: the sum of the ranges, ignoring any empty or reversed range. */
export function removedMs(ranges: readonly Range[]): number {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.endMs - range.startMs), 0);
}

type StepFacts = { readonly name: string; readonly status: string };
type JobFacts = { readonly status: string; readonly steps: readonly StepFacts[] };

/**
 * The AC-7 note for a finished take: `no_audio` when the trim step was skipped (the probe
 * found no audio), `no_cuts` when the job succeeded but made no render, else null.
 */
export function takeNote(job: JobFacts | null, hasRender: boolean): "no_audio" | "no_cuts" | null {
  if (!job || job.status !== "succeeded") return null;
  const step = (name: string) => job.steps.find((s) => s.name === name)?.status;
  if (step("trim") === "skipped") return "no_audio";
  if (!hasRender || step("render") === "skipped") return "no_cuts";
  return null;
}

/**
 * Retry (AC-10, spec 0002 `failed → processing`): any failure that isn't a media failure, on a
 * take that was probed (it has a length) and whose video hasn't expired. So a take cancelled
 * while running can be tried again; media problems mean "Upload another video" instead.
 */
export function isRetryable(
  take: {
    readonly status: string;
    readonly failureCode: string | null;
    readonly durationMs: number | null;
    readonly videoExpiresAt: Date | null;
  },
  now: Date,
): boolean {
  return (
    take.status === "failed" &&
    // The original is gone or about to go (the sweep may lag 15 minutes): nothing to retry.
    !isExpired(take, now) &&
    take.durationMs !== null &&
    !isMediaFailure(take.failureCode)
  );
}

export type MediaChoice =
  | { readonly ok: true; readonly file: "render" | "original" | "thumb"; readonly key: string }
  | { readonly ok: false; readonly error: "not_found" | "expired" };

/**
 * Which stored file a media kind serves (AC-7, AC-9, AC-12): `play` and `download` serve the
 * latest render, or the original when a ready take has no render (no cuts or no audio);
 * `original` serves the original once the upload finished; `thumb` serves the card thumbnail. Expired takes give `expired`.
 */
export function chooseMedia(
  kind: MediaKind,
  take: {
    readonly id: string;
    readonly status: string;
    readonly videoExpiresAt: Date | null;
    readonly originalKey: string | null;
  },
  render: { readonly status: string; readonly videoKey: string | null } | null,
  now: Date,
): MediaChoice {
  if (isExpired(take, now)) return { ok: false, error: "expired" };
  const original =
    take.originalKey && take.status !== "uploading"
      ? ({ ok: true, file: "original", key: take.originalKey } as const)
      : null;
  if (kind === "original") return original ?? { ok: false, error: "not_found" };
  // The thumbnail exists once the upload finished (the probe writes it); a missing file is
  // a 404 from the HEAD check in the route.
  if (kind === "thumb") {
    return original
      ? { ok: true, file: "thumb", key: thumbKey(take.id) }
      : { ok: false, error: "not_found" };
  }

  if (render?.status === "succeeded" && render.videoKey) {
    return { ok: true, file: "render", key: render.videoKey };
  }
  if (take.status === "ready" && original) return original;
  return { ok: false, error: "not_found" };
}
