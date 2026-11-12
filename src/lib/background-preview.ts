import { compositeFilters } from "./keying";
import type { Range } from "./trim";

/**
 * Rules for a background preview still (spec 0008, AC-4). Pure. A preview is one frame of the
 * take on a background, cached per take, background and cut version, and made by the
 * `preview-background` job.
 */

/**
 * The `preview-background` job's limits (the one place): each attempt may run 3 minutes, with 2
 * attempts. The task reads them for `maxDuration` and `retry`, and the stale rule below for how
 * long a `making` row can honestly still be running.
 */
export const PREVIEW_LIMITS = { maxDurationSeconds: 180, maxAttempts: 2 } as const;

/** The longest one preview can run: every attempt to its deadline (6 minutes). */
export const PREVIEW_RUN_MS = PREVIEW_LIMITS.maxDurationSeconds * PREVIEW_LIMITS.maxAttempts * 1000;

/** Queue time before the run starts (a preview of the same take runs at a time), and clock slack. */
export const PREVIEW_QUEUE_MARGIN_MS = 2 * 60_000;

/**
 * A preview that has been `making` this long is stale (8 minutes): a new request replaces it. A
 * shorter limit would reset a row whose job is still running or retrying, and the reset starts a
 * second run (the idempotency key carries `updatedAt`).
 */
export const PREVIEW_STALE_MS = PREVIEW_RUN_MS + PREVIEW_QUEUE_MARGIN_MS;

/** The width of a preview JPEG (its height follows the take's shape). */
export const PREVIEW_WIDTH = 1280;

/** `previews/{takeId}/{previewId}.jpg`: derived, so every preview file is reachable from a row. */
export function previewKey(takeId: string, previewId: string): string {
  return `previews/${takeId}/${previewId}.jpg`;
}

/**
 * The cut version of a take: a short hash of its applied cut ranges, so a preview is reused
 * until the cuts change. The ranges are sorted first, so the same cuts always give the same
 * version. Web Crypto, so it works in the Worker and in jobs.
 */
/**
 * Part of the cache identity: bump it when a change to keying makes the same take, background and
 * cuts produce a different still. A preview made under an older version no longer matches, so the
 * next request makes it again (S3S-T10 made it 2: stills made with the old fixed keying settings
 * could show the person erased). The old rows and files go with the take, as before.
 */
export const PREVIEW_STILL_VERSION = 2;

export async function cutVersion(ranges: readonly Range[]): Promise<string> {
  const text = `v${PREVIEW_STILL_VERSION}|${[...ranges]
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((r) => `${Math.round(r.startMs)}-${Math.round(r.endMs)}`)
    .join(",")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** True when a `making` preview last changed more than `PREVIEW_STALE_MS` before `now`. */
export function isStalePreview(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() > PREVIEW_STALE_MS;
}

/** The preview's height: its width scaled by the take's shape, rounded to an even number. */
export function previewHeight(takeWidth: number, takeHeight: number): number {
  return Math.max(2, Math.round((PREVIEW_WIDTH * takeHeight) / takeWidth / 2) * 2);
}

/**
 * The `-filter_complex` of a keyed preview: the take's frame (input 0, already seeked, tone
 * mapped when HDR) is keyed and put on the background (input 1) at the preview size, with the
 * same chain as the render (`compositeFilters` in keying.ts). `toneMap` is that filter for an
 * HDR source, null for SDR.
 */
export function keyedPreviewGraph(options: {
  readonly keyColor: string;
  readonly takeWidth: number;
  readonly takeHeight: number;
  readonly toneMap: string | null;
}): string {
  const { keyColor, takeWidth, takeHeight, toneMap } = options;
  const height = previewHeight(takeWidth, takeHeight);
  return [
    `[0:v]${toneMap ? `${toneMap},` : ""}scale=${PREVIEW_WIDTH}:${height}[base];`,
    ...compositeFilters({ keyColor, width: PREVIEW_WIDTH, height }),
  ].join("\n");
}

/** The `-vf` of a plain preview (no green screen): the frame tone mapped and scaled. */
export function plainPreviewFilter(options: {
  readonly takeWidth: number;
  readonly takeHeight: number;
  readonly toneMap: string | null;
}): string {
  const height = previewHeight(options.takeWidth, options.takeHeight);
  return [options.toneMap, `scale=${PREVIEW_WIDTH}:${height}`, "format=yuvj420p"]
    .filter(Boolean)
    .join(",");
}
