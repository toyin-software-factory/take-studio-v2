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
  previewHeight,
} from "./background-preview";
import { ffmpeg } from "./keying-greens-test-helpers";

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
