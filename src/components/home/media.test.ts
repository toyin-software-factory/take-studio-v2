import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { CAPABILITIES, FAN_CARDS, STUDIO } from "./content";
import {
  HOME_IMAGES,
  HOME_VIDEOS,
  MEDIA_BUDGET,
  type ImageFormat,
  imagePath,
  videoPath,
} from "./media";

const publicDir = join(process.cwd(), "public");
const onDisk = (url: string) => join(publicDir, url);

describe("homepage media files (spec 0010, AC-11)", () => {
  const formats: ImageFormat[] = ["avif", "webp", "jpg"];

  it("has every image in AVIF, WebP and JPEG at every listed width", () => {
    for (const [name, { widths }] of Object.entries(HOME_IMAGES)) {
      for (const width of widths) {
        for (const format of formats) {
          const file = onDisk(imagePath(name as keyof typeof HOME_IMAGES, width, format));
          expect(existsSync(file), file).toBe(true);
          expect(statSync(file).size).toBeGreaterThan(200);
        }
      }
    }
  });

  it("never lists a width above 1920, and starts with a 480 or the source's own width", () => {
    for (const { widths } of Object.values(HOME_IMAGES)) {
      expect(Math.max(...widths)).toBeLessThanOrEqual(1920);
      expect(Math.min(...widths)).toBeLessThanOrEqual(480);
    }
  });

  it("has MP4 and WebM for every video, tiles at 2.5 MB or less and the reel at 8 MB or less", () => {
    for (const name of HOME_VIDEOS) {
      const limit = name === "reel" ? MEDIA_BUDGET.reelBytes : MEDIA_BUDGET.tileBytes;
      for (const kind of ["mp4", "webm"] as const) {
        const file = onDisk(videoPath(name, kind));
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, file).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("uses only images the manifest knows", () => {
    for (const card of FAN_CARDS) expect(HOME_IMAGES).toHaveProperty(card.image);
    for (const s of STUDIO.key.swatches) expect(HOME_IMAGES).toHaveProperty(s.image);
    for (const tile of CAPABILITIES.tiles) {
      if (tile.media) expect(HOME_IMAGES).toHaveProperty(tile.media);
    }
  });

  it("is not embedded as base64 anywhere in the page's source files", () => {
    for (const file of ["content.ts", "home.css", "picture.tsx"]) {
      const text = readFileSync(join(process.cwd(), "src/components/home", file), "utf8");
      expect(text).not.toMatch(/base64,/);
    }
  });
});

describeWithFfmpeg("homepage videos carry no audio", () => {
  for (const name of HOME_VIDEOS) {
    for (const kind of ["mp4", "webm"] as const) {
      it(`${name}.${kind} has one video stream and no audio stream`, () => {
        const out = spawnSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            onDisk(videoPath(name, kind)),
          ],
          { encoding: "utf8" },
        );
        expect(out.stdout.trim().split("\n")).toEqual(["video"]);
      });
    }
  }
});
