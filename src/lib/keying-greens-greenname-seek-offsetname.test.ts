import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { keyedPreviewGraph } from "./background-preview";
import { thumbnailSeconds } from "./probe";
import { type Rgb, detectInFrame, toHex } from "./keying";
import {
  BOXES,
  HEIGHT,
  LIME_REAL,
  WIDTH,
  composeSeeked,
  greenLeft,
  keyedShare,
  makeBackgroundImage,
  makeClip,
  rawFrame,
} from "./keying-greens-test-helpers";

const SATURATED: Rgb = { r: 10, g: 140, b: 10 };
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
  },
);
