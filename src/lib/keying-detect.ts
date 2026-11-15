import { DETECTION, type RawFrame, type Rgb, isKeyable } from "./keying-config";

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
