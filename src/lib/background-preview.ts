import { compositeFilters } from "./keying";
import type { Range } from "./trim";

/**
 * Rules for a background preview still (spec 0008, AC-4). Pure. A preview is one frame of the
 * take on a background, cached per take, background and cut version, and made by the
 * `preview-background` job.
 */

/** A preview that has been `making` this long is stale: a new request replaces it. */
export const PREVIEW_STALE_MS = 2 * 60_000;

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
export async function cutVersion(ranges: readonly Range[]): Promise<string> {
  const text = [...ranges]
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((r) => `${Math.round(r.startMs)}-${Math.round(r.endMs)}`)
    .join(",");
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
