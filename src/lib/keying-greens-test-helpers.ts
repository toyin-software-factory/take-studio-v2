import { spawnSync } from "node:child_process";
import { expect } from "vitest";
import { type Rgb, frameSampleArgs, isGreen, sampleFrameSize } from "./keying";

/**
 * S3S-T10: the key must keep the person on every green, not only on a saturated chroma green.
 * Each case is a real encoded clip (H.264, BT.709, ±10 noise) with a green background and four
 * subjects on it, run through the real detection and then through BOTH the preview graph and the
 * render graph (`compositeFilters`). A subject pixel counts as keyed when the output shows the
 * new background (pure blue) there; a background pixel is "left" when it is still green.
 */
export const WIDTH = 640;
export const HEIGHT = 360;
export const BLUE: Rgb = { r: 0, g: 0, b: 255 };
export const SUBJECTS: Readonly<Record<string, Rgb>> = {
  grey: { r: 146, g: 148, b: 140 },
  "light skin": { r: 224, g: 172, b: 140 },
  "dark skin": { r: 126, g: 85, b: 64 },
  "dark clothing": { r: 40, g: 40, b: 45 },
};
export const BOXES: Readonly<Record<string, { x: number; y: number; w: number; h: number }>> = {
  grey: { x: 120, y: 90, w: 80, h: 160 },
  "light skin": { x: 220, y: 90, w: 80, h: 160 },
  "dark skin": { x: 320, y: 90, w: 80, h: 160 },
  "dark clothing": { x: 420, y: 90, w: 80, h: 160 },
};
export const hex = ({ r, g, b }: Rgb) =>
  `0x${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
export function ffmpeg(args: string[], input?: Buffer): Buffer {
  const run = spawnSync("ffmpeg", ["-v", "error", ...args], {
    input,
    maxBuffer: 256 << 20,
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.toString().slice(0, 300)}`);
  return run.stdout;
}
/** An encoded clip: the green with the four subjects, ±10 noise, tagged BT.709 like real footage. */
export function makeClip(
  path: string,
  green: Rgb,
  opts: { frames?: number; fps?: string } = {},
): void {
  const draw = Object.entries(BOXES)
    .map(
      ([name, b]) =>
        `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${hex(SUBJECTS[name]!)}:t=fill`,
    )
    .join(",");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${hex(green)}:s=${WIDTH}x${HEIGHT}:r=${opts.fps ?? "25"}:d=10,${draw},noise=alls=10:allf=t+u:all_seed=7,format=rgb24,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    "-frames:v",
    String(opts.frames ?? 3),
    "-c:v",
    "libx264",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    path,
  ]);
}
export function rawFrame(clip: string) {
  const size = sampleFrameSize(WIDTH, HEIGHT);
  const data = ffmpeg(frameSampleArgs(clip, 0, size, null).slice(2));
  return { width: size.width, height: size.height, data: new Uint8Array(data) };
}
/** Share of the pixels in a box (inset 8 %, scaled to the output) that show the blue background. */
export function keyedShare(
  rgb: Uint8Array,
  outWidth: number,
  box: { x: number; y: number; w: number; h: number },
) {
  const k = outWidth / WIDTH;
  const inset = 0.08;
  const x0 = Math.round((box.x + box.w * inset) * k);
  const x1 = Math.round((box.x + box.w * (1 - inset)) * k);
  const y0 = Math.round((box.y + box.h * inset) * k);
  const y1 = Math.round((box.y + box.h * (1 - inset)) * k);
  let n = 0;
  let keyed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * outWidth + x) * 3;
      const near =
        Math.abs(rgb[i]! - BLUE.r) +
        Math.abs(rgb[i + 1]! - BLUE.g) +
        Math.abs(rgb[i + 2]! - BLUE.b);
      n += 1;
      if (near < 100) keyed += 1;
    }
  }
  return keyed / n;
}
/** Share of the background strip (below the subjects) that is still green after keying. */
export function greenLeft(rgb: Uint8Array, outWidth: number) {
  const k = outWidth / WIDTH;
  let n = 0;
  let left = 0;
  for (let y = Math.round(280 * k); y < Math.round(350 * k); y++) {
    for (let x = Math.round(20 * k); x < Math.round(620 * k); x++) {
      const i = (y * outWidth + x) * 3;
      n += 1;
      if (isGreen({ r: rgb[i]!, g: rgb[i + 1]!, b: rgb[i + 2]! })) left += 1;
    }
  }
  return left / n;
}
/**
 * S3S-T12: the preview seeks (`-ss`) into the take, so the keyed frame's timestamp is a little
 * above 0 when no frame sits exactly on the seek point (any 23.976 or 29.97 fps phone clip, since
 * `thumbnailSeconds` is exactly 1 s), while the background is one image frame at 0. `overlay` then
 * had no keyed frame at the background's time and passed the background through: a still with
 * the whole person gone, though the key and the 85 % guard were right.
 */
export const LIME_REAL: Rgb = { r: 135, g: 255, b: 80 };
// G minus max(R,B) is +130

/** A one frame image file, the shape of a studio background (the real one is a JPEG). */
export function makeBackgroundImage(path: string, width: number, height: number): void {
  ffmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x0000ff:s=${width}x${height}:d=1`,
    "-frames:v",
    "1",
    path,
  ]);
}
/** The preview's own command shape: seek, then the take and a single image as inputs 0 and 1. */
export function composeSeeked(
  clip: string,
  image: string,
  seconds: number,
  graph: string,
  width: number,
  height: number,
): Uint8Array {
  const out = ffmpeg([
    "-ss",
    seconds.toFixed(3),
    "-i",
    clip,
    "-i",
    image,
    "-filter_complex",
    graph,
    "-map",
    "[vout]",
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "-",
  ]);
  expect(out.length).toBe(width * height * 3);
  return new Uint8Array(out);
}
