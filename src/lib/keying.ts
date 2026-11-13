/**
 * Green screen detection and the chroma key filter chain (spec 0008, Rationale and Pipeline 3).
 * Pure: it works on raw RGB frames handed in by the job and builds ffmpeg filter text; running
 * ffmpeg lives in `src/trigger`. This is the one place keying is decided, so AI matting could
 * replace it later without touching the data model or the UI.
 */

import { ORIGINAL_INPUT } from "./ffmpeg-input";

/** One 8 bit RGB pixel. */
export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/** A decoded frame: `width * height` pixels as `r g b` bytes, row by row. */
export type RawFrame = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

/**
 * The detection rule (spec 0008, Rationale): sample frames after the same HDR to SDR tone map
 * the render uses, measure patches along the left, right and top edges, and call the take
 * usable when most patches are green in most frames. Heuristics, tuned with fixtures.
 */
export const DETECTION = {
  /** Where in the take the frames are sampled (fractions of its length). */
  sampleFractions: [0.1, 0.3, 0.5, 0.7, 0.9],
  /** Each patch is this fraction of the frame's width and of its height. */
  patchFraction: 0.04,
  /** A patch is green when its median HSV is in these ranges. */
  hueMinDeg: 80,
  hueMaxDeg: 160,
  minSaturation: 0.2,
  minValue: 0.25,
  /** Usable when at least this many of the 16 patches are green ... */
  minGreenPatches: 10,
  /** ... in at least this many of the sampled frames. */
  minGreenFrames: 3,
  /** Width the sampled frames are scaled to before measuring (the patches are 4 % of it). */
  frameWidth: 320,
} as const;

/**
 * Chroma key settings, tuned with the fixtures (spec 0008 build step 1) and made adaptive in
 * S3S-T10. `similarity` and `blend` are the ceilings, right for a saturated chroma green. ffmpeg's
 * `chromakey` compares only the U and V planes, so a pale or dark green sits close to neutral in
 * UV, and a grey sweater, skin or dark clothing sit inside a fixed 0.12 + 0.08 window and are
 * keyed out with the screen. `keySettings` therefore scales both with the key colour's own
 * distance from neutral, and a key too close to neutral (below `minChroma`) is not used at all.
 */
export const KEYING = {
  similarity: 0.12,
  blend: 0.08,
  /** Similarity is at most this share of the key's distance from neutral (UV, chromakey units). */
  similarityPerChroma: 0.3,
  /** Blend is at most this share of it. */
  blendPerChroma: 0.22,
  /** A key colour closer to neutral than this cannot be told from grey and skin: no green screen. */
  minChroma: 0.12,
  /** A key that would make more of the frame transparent than this erases the subject too. */
  maxKeyedShare: 0.85,
} as const;

/**
 * How far a colour is from neutral in the U and V planes, in the units `chromakey`'s similarity
 * uses (0 neutral, about 0.5 for a pure saturated colour). It uses the same BT.601 integer
 * formula as ffmpeg's `chromakey` does for its key colour.
 */
export function keyChroma({ r, g, b }: Rgb): number {
  const u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
  const v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
  return Math.hypot(u - 128, v - 128) / (128 * Math.SQRT2);
}

/** The `chromakey` similarity and blend for a key colour: the ceilings, scaled down for a pale or dark green. */
export function keySettings(key: Rgb): { readonly similarity: number; readonly blend: number } {
  const chroma = keyChroma(key);
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    similarity: round(Math.min(KEYING.similarity, KEYING.similarityPerChroma * chroma)),
    blend: round(Math.min(KEYING.blend, KEYING.blendPerChroma * chroma)),
  };
}

/** True when the key colour is far enough from neutral to separate the screen from the subject. */
export function isKeyable(key: Rgb): boolean {
  return keyChroma(key) >= KEYING.minChroma;
}

/** The share (0 to 1) of an 8 bit alpha plane that is transparent (below half). */
export function transparentShare(alpha: Uint8Array): number {
  if (alpha.length === 0) return 1;
  let transparent = 0;
  for (const a of alpha) if (a < 128) transparent += 1;
  return transparent / alpha.length;
}

/** True when keying would remove so much of the frame that the subject must be gone too. */
export function erasesSubject(share: number): boolean {
  return share > KEYING.maxKeyedShare;
}

export type Patch = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * The 16 patches (pixels): 5 down the left edge, 5 down the right edge and 6 across the top,
 * each 4 % of the width by 4 % of the height, spaced so none overlap. The subject stands in
 * the middle, so the borders are where a green screen shows.
 */
export function patchRects(width: number, height: number): Patch[] {
  const w = Math.max(1, Math.round(width * DETECTION.patchFraction));
  const h = Math.max(1, Math.round(height * DETECTION.patchFraction));
  const at = (fx: number, fy: number): Patch => ({
    x: Math.min(width - w, Math.max(0, Math.round(fx * width))),
    y: Math.min(height - h, Math.max(0, Math.round(fy * height))),
    w,
    h,
  });
  const patches: Patch[] = [];
  for (let i = 0; i < 5; i++) {
    const fy = 0.1 + i * 0.18;
    patches.push(at(0, fy), at(1, fy));
  }
  for (let i = 0; i < 6; i++) patches.push(at(0.04 + i * 0.18, 0));
  return patches;
}

/** Hue (degrees 0 to 360), saturation and value (0 to 1) of an RGB colour. */
export function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The median colour of a patch: each channel's median over the patch's pixels. */
export function patchMedian(frame: RawFrame, patch: Patch): Rgb {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (let y = patch.y; y < patch.y + patch.h; y++) {
    for (let x = patch.x; x < patch.x + patch.w; x++) {
      const i = (y * frame.width + x) * 3;
      r.push(frame.data[i]!);
      g.push(frame.data[i + 1]!);
      b.push(frame.data[i + 2]!);
    }
  }
  return { r: median(r), g: median(g), b: median(b) };
}

/** True when a patch's median colour counts as green (hue, saturation and value rules). */
export function isGreen(color: Rgb): boolean {
  const { h, s, v } = rgbToHsv(color);
  return (
    h >= DETECTION.hueMinDeg &&
    h <= DETECTION.hueMaxDeg &&
    s >= DETECTION.minSaturation &&
    v >= DETECTION.minValue
  );
}

/** Why a take has no usable key: no green screen found, a key too close to neutral, or a key that would erase the subject. */
export type NoKeyReason = "no_green" | "low_chroma" | "erases_subject";

export type Detection =
  | { readonly usable: false; readonly greenFrames: number; readonly reason?: NoKeyReason }
  | { readonly usable: true; readonly greenFrames: number; readonly keyColor: Rgb };

/**
 * Decides whether the take has a usable green screen from its sampled frames. Usable when at
 * least 10 of the 16 patches are green in at least 3 frames; the key colour is the median RGB
 * of every green patch seen.
 */
export function detectGreenScreen(frames: readonly RawFrame[]): Detection {
  let greenFrames = 0;
  const greens: Rgb[] = [];
  for (const frame of frames) {
    const found = patchRects(frame.width, frame.height)
      .map((patch) => patchMedian(frame, patch))
      .filter(isGreen);
    if (found.length >= DETECTION.minGreenPatches) greenFrames += 1;
    greens.push(...found);
  }
  if (greenFrames < DETECTION.minGreenFrames || greens.length === 0) {
    return { usable: false, greenFrames, reason: "no_green" };
  }
  const keyColor = {
    r: Math.round(median(greens.map((c) => c.r))),
    g: Math.round(median(greens.map((c) => c.g))),
    b: Math.round(median(greens.map((c) => c.b))),
  };
  if (!isKeyable(keyColor)) return { usable: false, greenFrames, reason: "low_chroma" };
  return { usable: true, greenFrames, keyColor };
}

/**
 * Detection on one frame (the preview, spec 0008 pipeline 4): usable when at least 10 of the 16
 * border patches are green in that frame. The key colour is the median of the green patches.
 */
export function detectInFrame(frame: RawFrame): Detection {
  const greens = patchRects(frame.width, frame.height)
    .map((patch) => patchMedian(frame, patch))
    .filter(isGreen);
  if (greens.length < DETECTION.minGreenPatches) {
    return { usable: false, greenFrames: 0, reason: "no_green" };
  }
  const keyColor = {
    r: Math.round(median(greens.map((c) => c.r))),
    g: Math.round(median(greens.map((c) => c.g))),
    b: Math.round(median(greens.map((c) => c.b))),
  };
  if (!isKeyable(keyColor)) return { usable: false, greenFrames: 1, reason: "low_chroma" };
  return { usable: true, greenFrames: 1, keyColor };
}

/** Times (ms) of the frames to sample: 10, 30, 50, 70 and 90 % of the take. */
export function sampleTimesMs(durationMs: number): number[] {
  return DETECTION.sampleFractions.map((f) => Math.round(durationMs * f));
}

/** `#rrggbb` (lower case) of a colour. */
export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** The colour of a `#rrggbb` string, or null when it is not one. */
export function fromHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return { r: parseInt(match[1]!, 16), g: parseInt(match[2]!, 16), b: parseInt(match[3]!, 16) };
}

/** Even, positive output size of a frame scaled to `frameWidth` wide (what `scale=W:-2` gives). */
export function sampleFrameSize(width: number, height: number): { width: number; height: number } {
  const w = DETECTION.frameWidth;
  const h = Math.max(2, Math.round((height * w) / width / 2) * 2);
  return { width: w, height: h };
}

/**
 * ffmpeg arguments that decode one frame of `source` at `timeMs` as raw `rgb24` bytes on stdout
 * at the sample size, after the same tone map the render uses (`toneMap` is that filter text
 * for an HDR source, null for SDR).
 */
export function frameSampleArgs(
  source: string,
  timeMs: number,
  size: { readonly width: number; readonly height: number },
  toneMap: string | null,
): string[] {
  const filters = [toneMap, `scale=${size.width}:${size.height}`, "format=rgb24"].filter(Boolean);
  return [
    "-v",
    "error",
    "-ss",
    (timeMs / 1000).toFixed(3),
    ...ORIGINAL_INPUT,
    "-i",
    source,
    "-frames:v",
    "1",
    "-vf",
    filters.join(","),
    "-f",
    "rawvideo",
    "-",
  ];
}

/**
 * ffmpeg arguments that decode one frame of `source` at `timeMs`, tone mapped like the render,
 * key it with the settings the render would use, and write the alpha plane as raw 8 bit gray
 * bytes (`width * height`). Counting the transparent bytes (`transparentShare`) shows what the
 * key would remove, on the real decode path, whatever the cause of a bad key.
 */
export function frameAlphaArgs(
  source: string,
  timeMs: number,
  size: { readonly width: number; readonly height: number },
  toneMap: string | null,
  keyColor: string,
): string[] {
  const { similarity, blend } = keySettings(fromHex(keyColor) ?? { r: 0, g: 177, b: 64 });
  const filters = [
    toneMap,
    `scale=${size.width}:${size.height}`,
    `format=yuva444p,chromakey=0x${keyColor.replace("#", "")}:${similarity}:${blend}`,
    "alphaextract",
    "format=gray",
  ].filter(Boolean);
  return [
    "-v",
    "error",
    "-ss",
    (timeMs / 1000).toFixed(3),
    ...ORIGINAL_INPUT,
    "-i",
    source,
    "-frames:v",
    "1",
    "-vf",
    filters.join(","),
    "-f",
    "rawvideo",
    "-",
  ];
}

/** What the render needs to put a keyed take on a background. */
export type BackgroundComposite = {
  /** The detected green, `#rrggbb`. */
  readonly keyColor: string;
  /** The take's display size (after rotation): the background is covered and cropped to it. */
  readonly width: number;
  readonly height: number;
};

/**
 * The filter lines that follow the colour step: key the take's video (chroma key, then green
 * spill removal), scale the background (input 1) to cover the take's frame and centre crop it,
 * and overlay. `[base]` is the concatenated, tone mapped take; the result is `[vout]`. The
 * keying runs on `yuva444p` so 10 bit and 4:2:0 sources key cleanly at the edges; the output
 * is `yuv420p`.
 *
 * The keyed frames start at time 0 (`setpts=PTS-STARTPTS`, S3S-T12). `overlay` pairs a frame of
 * each input by time, and the background is an image whose first frame is at 0. A preview seeks
 * into the take (`-ss`), and its first frame is then a little after 0 whenever no frame sits
 * exactly on the seek point (23.976 or 29.97 fps, an edit list): `overlay` has no keyed frame at
 * the background's time and passes the background through, so the whole person is gone.
 */
export function compositeFilters(composite: BackgroundComposite): string[] {
  const { keyColor, width, height } = composite;
  const key = `0x${keyColor.replace("#", "")}`;
  const { similarity, blend } = keySettings(fromHex(keyColor) ?? { r: 0, g: 177, b: 64 });
  return [
    `[base]setpts=PTS-STARTPTS,format=yuva444p,chromakey=${key}:${similarity}:${blend},despill=type=green[fg];`,
    `[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase:out_range=tv,crop=${width}:${height},setsar=1,format=yuv420p[bg];`,
    "[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[vout]",
  ];
}
