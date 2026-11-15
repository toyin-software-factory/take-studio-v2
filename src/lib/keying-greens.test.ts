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
  toHex,
  transparentShare,
} from "./keying";
import {
  BOXES,
  HEIGHT,
  WIDTH,
  ffmpeg,
  greenLeft,
  keyedShare,
  makeClip,
  rawFrame,
} from "./keying-greens-test-helpers";

/** The greens: deep chroma, Toyin's lime, a pale mint, a shadowed cloth and a duller mint. */
const GREENS: ReadonlyArray<readonly [string, Rgb]> = [
  ["deep chroma green", { r: 0, g: 177, b: 64 }],
  ["lime (a virtual green screen)", { r: 125, g: 245, b: 75 }],
  ["pale mint", { r: 170, g: 230, b: 190 }],
  ["shadowed cloth green", { r: 40, g: 110, b: 55 }],
  ["duller mint", { r: 150, g: 215, b: 170 }],
]; /** Runs a filter graph over the clip and a blue background; returns the first frame as rgb24. */
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
