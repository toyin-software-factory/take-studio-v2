import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { keyedPreviewGraph } from "./background-preview";
import {
  type Rgb,
  compositeFilters,
  detectInFrame,
  frameAlphaArgs,
  frameSampleArgs,
  isGreen,
  sampleFrameSize,
  toHex,
  transparentShare,
} from "./keying";

/**
 * S3S-T10: the key must keep the person on every green, not only on a saturated chroma green.
 * Each case is a real encoded clip (H.264, BT.709, ±10 noise) with a green background and four
 * subjects on it, run through the real detection and then through BOTH the preview graph and the
 * render graph (`compositeFilters`). A subject pixel counts as keyed when the output shows the
 * new background (pure blue) there; a background pixel is "left" when it is still green.
 */
const WIDTH = 640;
const HEIGHT = 360;
const BLUE: Rgb = { r: 0, g: 0, b: 255 };

const SUBJECTS: Readonly<Record<string, Rgb>> = {
  grey: { r: 146, g: 148, b: 140 },
  "light skin": { r: 224, g: 172, b: 140 },
  "dark skin": { r: 126, g: 85, b: 64 },
  "dark clothing": { r: 40, g: 40, b: 45 },
};
const BOXES: Readonly<Record<string, { x: number; y: number; w: number; h: number }>> = {
  grey: { x: 120, y: 90, w: 80, h: 160 },
  "light skin": { x: 220, y: 90, w: 80, h: 160 },
  "dark skin": { x: 320, y: 90, w: 80, h: 160 },
  "dark clothing": { x: 420, y: 90, w: 80, h: 160 },
};

/** The greens: deep chroma, Toyin's lime, a pale mint, a shadowed cloth and a duller mint. */
const GREENS: ReadonlyArray<readonly [string, Rgb]> = [
  ["deep chroma green", { r: 0, g: 177, b: 64 }],
  ["lime (a virtual green screen)", { r: 125, g: 245, b: 75 }],
  ["pale mint", { r: 170, g: 230, b: 190 }],
  ["shadowed cloth green", { r: 40, g: 110, b: 55 }],
  ["duller mint", { r: 150, g: 215, b: 170 }],
];

const hex = ({ r, g, b }: Rgb) =>
  `0x${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

function ffmpeg(args: string[], input?: Buffer): Buffer {
  const run = spawnSync("ffmpeg", ["-v", "error", ...args], {
    input,
    maxBuffer: 256 << 20,
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.toString().slice(0, 300)}`);
  return run.stdout;
}

/** An encoded clip: the green with the four subjects, ±10 noise, tagged BT.709 like real footage. */
function makeClip(path: string, green: Rgb): void {
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
    `color=c=${hex(green)}:s=${WIDTH}x${HEIGHT}:d=1,${draw},noise=alls=10:allf=t+u:all_seed=7,format=rgb24,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    "-frames:v",
    "3",
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

function rawFrame(clip: string) {
  const size = sampleFrameSize(WIDTH, HEIGHT);
  const data = ffmpeg(frameSampleArgs(clip, 0, size, null).slice(2));
  return { width: size.width, height: size.height, data: new Uint8Array(data) };
}

/** Runs a filter graph over the clip and a blue background; returns the first frame as rgb24. */
function compose(clip: string, graph: string, width: number, height: number): Uint8Array {
  const out = ffmpeg([
    "-i",
    clip,
    "-f",
    "lavfi",
    "-i",
    `color=c=0x0000ff:s=${width}x${height}:d=1`,
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

/** Share of the pixels in a box (inset 8 %, scaled to the output) that show the blue background. */
function keyedShare(
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
function greenLeft(rgb: Uint8Array, outWidth: number) {
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

describeWithFfmpeg("keeping the person on every green (S3S-T10)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "keying-greens-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const [name, green] of GREENS) {
    it(`${name}: detected, the subjects survive and the green goes, in the preview and the render`, () => {
      const clip = join(dir, `${name.replace(/\W+/g, "-")}.mp4`);
      makeClip(clip, green);
      const detection = detectInFrame(rawFrame(clip));
      expect(detection.usable).toBe(true);
      if (!detection.usable) return;
      const keyColor = toHex(detection.keyColor);

      const previewHeight = 720;
      const outputs = {
        preview: {
          width: 1280,
          rgb: compose(
            clip,
            keyedPreviewGraph({ keyColor, takeWidth: WIDTH, takeHeight: HEIGHT, toneMap: null }),
            1280,
            previewHeight,
          ),
        },
        render: {
          width: WIDTH,
          rgb: compose(
            clip,
            [
              "[0:v]null[base];",
              ...compositeFilters({ keyColor, width: WIDTH, height: HEIGHT }),
            ].join("\n"),
            WIDTH,
            HEIGHT,
          ),
        },
      };
      for (const [path, out] of Object.entries(outputs)) {
        for (const [subject, box] of Object.entries(BOXES)) {
          const share = keyedShare(out.rgb, out.width, box);
          expect(share, `${path}: ${subject} keyed`).toBeLessThan(0.02);
        }
        expect(greenLeft(out.rgb, out.width), `${path}: green left`).toBeLessThan(0.01);
      }

      // The guard sees the same thing: the key removes the screen, a normal share of the frame.
      const alpha = ffmpeg(
        frameAlphaArgs(clip, 0, { width: WIDTH, height: HEIGHT }, null, keyColor).slice(2),
      );
      const share = transparentShare(new Uint8Array(alpha));
      expect(share).toBeGreaterThan(0.3);
      expect(share).toBeLessThan(0.85);
    });
  }

  it("a green too close to grey is not keyed at all: no green screen, never an erased person", () => {
    const clip = join(dir, "near-grey.mp4");
    makeClip(clip, { r: 150, g: 165, b: 155 });
    const detection = detectInFrame(rawFrame(clip));
    // Either nothing counts as green, or the key is too close to neutral to use.
    expect(detection.usable).toBe(false);
  });
});
