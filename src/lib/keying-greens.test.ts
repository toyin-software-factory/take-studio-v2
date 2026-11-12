import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import {
  PREVIEW_GATE,
  PREVIEW_WIDTH,
  centreDifferenceShare,
  gateReadArgs,
  gateSize,
  keyedPreviewGraph,
  previewHeight,
} from "./background-preview";
import { thumbnailSeconds } from "./probe";
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
function makeClip(path: string, green: Rgb, opts: { frames?: number; fps?: string } = {}): void {
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

/**
 * S3S-T12: the preview seeks (`-ss`) into the take, so the keyed frame's timestamp is a little
 * above 0 when no frame sits exactly on the seek point (any 23.976 or 29.97 fps phone clip, since
 * `thumbnailSeconds` is exactly 1 s), while the background is one image frame at 0. `overlay` then
 * had no keyed frame at the background's time and passed the background through: a still with
 * the whole person gone, though the key and the 85 % guard were right.
 */
const LIME_REAL: Rgb = { r: 135, g: 255, b: 80 };
const SATURATED: Rgb = { r: 10, g: 140, b: 10 }; // G minus max(R,B) is +130

/** A one frame image file, the shape of a studio background (the real one is a JPEG). */
function makeBackgroundImage(path: string, width: number, height: number): void {
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
function composeSeeked(
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

describeWithFfmpeg(
  "the preview keeps the person when the seek lands between frames (S3S-T12)",
  () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "keying-seek-"));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    // 23.976 fps: no frame at 1.000 s (frames are at k * 1.001 / 24), the real case of a phone clip.
    const FRAME = 1001 / 24_000;
    const OFFSETS: ReadonlyArray<readonly [string, number]> = [
      ["on the thumbnail time (first frame at 1.001 s)", 0],
      ["+0.01 s", 0.01],
      ["+0.02 s", 0.02],
      ["+half a frame", FRAME / 2],
    ];

    for (const [greenName, green] of [
      ["Toyin's lime (135, 255, 80)", LIME_REAL],
      ["a saturated green (G minus max(R,B) +130)", SATURATED],
    ] as const) {
      for (const [offsetName, offset] of OFFSETS) {
        it(`${greenName}, seek ${offsetName}`, () => {
          const clip = join(dir, `seek-${greenName.length}-${offset}.mp4`);
          makeClip(clip, green, { frames: 96, fps: "24000/1001" });
          const image = join(dir, "bg.png");
          makeBackgroundImage(image, 1280, 720);
          const detection = detectInFrame(rawFrame(clip));
          expect(detection.usable).toBe(true);
          if (!detection.usable) return;
          const keyColor = toHex(detection.keyColor);

          const durationMs = 4_000; // over 2 s, so the seek is the real thumbnailSeconds: 1 s
          const seek = thumbnailSeconds(durationMs) + offset;
          const rgb = composeSeeked(
            clip,
            image,
            seek,
            keyedPreviewGraph({ keyColor, takeWidth: WIDTH, takeHeight: HEIGHT, toneMap: null }),
            1280,
            720,
          );
          for (const [subject, box] of Object.entries(BOXES)) {
            expect(keyedShare(rgb, 1280, box), `${subject} keyed away`).toBeLessThan(0.02);
          }
          expect(greenLeft(rgb, 1280), "green left").toBeLessThan(0.01);
        });
      }
    }

    it("the render path: compositeFilters keeps the person when the take's first frame is not at 0", () => {
      const clip = join(dir, "render.mp4");
      makeClip(clip, LIME_REAL, { frames: 48, fps: "24000/1001" });
      const image = join(dir, "bg-render.png");
      makeBackgroundImage(image, WIDTH, HEIGHT);
      const detection = detectInFrame(rawFrame(clip));
      expect(detection.usable).toBe(true);
      if (!detection.usable) return;
      const keyColor = toHex(detection.keyColor);
      // The render's [base] is a concat whose first frame can start after 0 (a trim keeps a range
      // that does not begin on a frame, an edit list, an audio first start): shift it the same way.
      for (const shift of [0.001, 0.02, 0.04]) {
        const rgb = composeSeeked(
          clip,
          image,
          0,
          [
            `[0:v]setpts=PTS+${shift}/TB[base];`,
            ...compositeFilters({ keyColor, width: WIDTH, height: HEIGHT }),
          ].join("\n"),
          WIDTH,
          HEIGHT,
        );
        for (const [subject, box] of Object.entries(BOXES)) {
          expect(keyedShare(rgb, WIDTH, box), `shift ${shift}: ${subject} keyed away`).toBeLessThan(
            0.02,
          );
        }
      }
    });
  },
);

/**
 * S3S-T12 review: the gate compares a still that was scaled to 1280 and JPEG encoded, then read at
 * 192, with the background. On a detailed background a one step read of the image gave edge
 * differences over 30 of 255 in more than 2 % of the centre third, so a still of only the
 * background looked like it had a person. The reference now takes the same two steps.
 */
describeWithFfmpeg(
  "the gate sees a personless still on a detailed background as only the background",
  () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "keying-gate-"));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const read = (args: string[], size: { width: number; height: number }) => ({
      ...size,
      data: new Uint8Array(ffmpeg(args)),
    });

    it("stays under the gate share, and the old one step reference did not", () => {
      // High contrast colour detail (hard edges in all three channels, period 60 px).
      const image = join(dir, "detail.png");
      ffmpeg([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "nullsrc=s=1920x1080,geq=r='255*gt(sin(X*2*PI/60),0)':g='255*gt(sin(Y*2*PI/60),0)':b='255*gt(sin((X+Y)*2*PI/60),0)'",
        "-frames:v",
        "1",
        image,
      ]);
      const height = previewHeight(1920, 1080);
      // The still the keyed path writes when the person is erased: the background through the
      // preview's own chain, JPEG at the job's quality.
      const still = join(dir, "still.jpg");
      ffmpeg([
        "-y",
        "-i",
        image,
        "-vf",
        `scale=${PREVIEW_WIDTH}:${height}:force_original_aspect_ratio=increase:out_range=tv,crop=${PREVIEW_WIDTH}:${height},setsar=1,format=yuv420p,format=yuvj420p`,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        still,
      ]);
      const gate = gateSize(1920, 1080);
      const stillFrame = read(gateReadArgs(still, gate, null), gate);
      const same = read(gateReadArgs(image, gate, { width: PREVIEW_WIDTH, height }), gate);
      expect(centreDifferenceShare(stillFrame, same)).toBeLessThan(PREVIEW_GATE.minCentreShare);

      // What the gate did before: one scale straight from the original.
      const oneStep = read(
        [
          "-i",
          image,
          "-frames:v",
          "1",
          "-vf",
          `scale=${gate.width}:${gate.height}:force_original_aspect_ratio=increase,crop=${gate.width}:${gate.height},format=rgb24`,
          "-f",
          "rawvideo",
          "-",
        ],
        gate,
      );
      expect(centreDifferenceShare(stillFrame, oneStep)).toBeGreaterThanOrEqual(
        PREVIEW_GATE.minCentreShare,
      );
    });
  },
);
