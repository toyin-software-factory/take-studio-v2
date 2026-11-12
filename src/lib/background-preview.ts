import { type RawFrame, compositeFilters } from "./keying";
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
export const PREVIEW_STILL_VERSION = 3;

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

/**
 * The final gate (S3S-T12), defence in depth behind the key guard: after a keyed still is encoded,
 * its centre third is compared with the background it was put on. The person stands in the middle
 * and covers most of that third (a head and shoulders are 25 to 30 % of the frame, centred), so a
 * real keyed still differs there in a large share of pixels, tens of percent. A still that equals
 * the background (the person erased, whatever the cause) differs in 0.0 %, JPEG noise included
 * (measured on the live take: 0.0 %, and a pixel differs only when a channel is off by more than
 * 30 of 255, well above noise and the 16 to 235 range squash). 2 % sits far from both: even a
 * small, distant subject fills more, and a still of an empty frame is correctly the plain frame.
 * Such a still is not recorded as Ready: the preview falls back to the plain frame and says
 * `no_green_screen`.
 */
export const PREVIEW_GATE = {
  /** The still and the background are both read at this width (height follows the take). */
  width: 192,
  /** A pixel differs when any channel is off by more than this (of 255). */
  channelDiff: 30,
  /** The still is just the background when fewer than this share of the centre third differs. */
  minCentreShare: 0.02,
} as const;

/** The size both images are read at for the gate: 192 wide, even height following the take. */
export function gateSize(takeWidth: number, takeHeight: number): { width: number; height: number } {
  const height = Math.max(2, Math.round((PREVIEW_GATE.width * takeHeight) / takeWidth / 2) * 2);
  return { width: PREVIEW_GATE.width, height };
}

/**
 * ffmpeg arguments that read one image as raw `rgb24` at the gate size on stdout. `cover` is for the
 * background (scaled to cover and centre cropped, as the preview graph does); the still is scaled.
 */
export function gateReadArgs(
  input: string,
  size: { readonly width: number; readonly height: number },
  cover: boolean,
  inputOptions: readonly string[] = [],
): string[] {
  const scale = cover
    ? `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}`
    : `scale=${size.width}:${size.height}`;
  return [
    "-v",
    "error",
    ...inputOptions,
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    `${scale},format=rgb24`,
    "-f",
    "rawvideo",
    "-",
  ];
}

/**
 * The share (0 to 1) of the centre third (the middle third of the width, full height) where the
 * still differs from the background by more than `PREVIEW_GATE.channelDiff` in any channel. Both
 * frames must be the same size.
 */
export function centreDifferenceShare(still: RawFrame, background: RawFrame): number {
  if (still.width !== background.width || still.height !== background.height) return 1;
  const x0 = Math.floor(still.width / 3);
  const x1 = Math.ceil((still.width * 2) / 3);
  let differs = 0;
  let total = 0;
  for (let y = 0; y < still.height; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * still.width + x) * 3;
      total += 1;
      const d = Math.max(
        Math.abs(still.data[i]! - background.data[i]!),
        Math.abs(still.data[i + 1]! - background.data[i + 1]!),
        Math.abs(still.data[i + 2]! - background.data[i + 2]!),
      );
      if (d > PREVIEW_GATE.channelDiff) differs += 1;
    }
  }
  return total === 0 ? 1 : differs / total;
}

/** True when a keyed still barely differs from its background in the centre third: no person in it. */
export function isOnlyBackground(centreShare: number): boolean {
  return centreShare < PREVIEW_GATE.minCentreShare;
}
