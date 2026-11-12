/**
 * Green screen detection and the chroma key filter chain (spec 0008, Rationale and Pipeline 3).
 * Pure: it works on raw RGB frames handed in by the job and builds ffmpeg filter text; running
 * ffmpeg lives in `src/trigger`. This is the one place keying is decided, so AI matting could
 * replace it later without touching the data model or the UI.
 */

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
  minSaturation: 0.3,
  minValue: 0.25,
  /** Usable when at least this many of the 16 patches are green ... */
  minGreenPatches: 10,
  /** ... in at least this many of the sampled frames. */
  minGreenFrames: 3,
  /** Width the sampled frames are scaled to before measuring (the patches are 4 % of it). */
  frameWidth: 320,
} as const;

/** Chroma key settings, tuned with the fixtures (spec 0008 build step 1). */
export const KEYING = {
  similarity: 0.12,
  blend: 0.08,
} as const;

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

export type Detection =
  | { readonly usable: false; readonly greenFrames: number }
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
    return { usable: false, greenFrames };
  }
  return {
    usable: true,
    greenFrames,
    keyColor: {
      r: Math.round(median(greens.map((c) => c.r))),
      g: Math.round(median(greens.map((c) => c.g))),
      b: Math.round(median(greens.map((c) => c.b))),
    },
  };
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
 */
export function compositeFilters(composite: BackgroundComposite): string[] {
  const { keyColor, width, height } = composite;
  const key = `0x${keyColor.replace("#", "")}`;
  return [
    `[base]format=yuva444p,chromakey=${key}:${KEYING.similarity}:${KEYING.blend},despill=type=green[fg];`,
    `[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase:out_range=tv,crop=${width}:${height},setsar=1,format=yuv420p[bg];`,
    "[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[vout]",
  ];
}
