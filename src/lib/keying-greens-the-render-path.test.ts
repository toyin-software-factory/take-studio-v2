import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { compositeFilters, detectInFrame, toHex } from "./keying";
import {
  BOXES,
  HEIGHT,
  LIME_REAL,
  WIDTH,
  composeSeeked,
  keyedShare,
  makeBackgroundImage,
  makeClip,
  rawFrame,
} from "./keying-greens-test-helpers";

describeWithFfmpeg(
  "the preview keeps the person when the seek lands between frames (S3S-T12)",
  () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "keying-seek-"));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
