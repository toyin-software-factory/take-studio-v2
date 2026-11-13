import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { imageDemuxer, imageInput } from "@/lib/ffmpeg-input";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { MediaToolError, probeFile, probeImageFile, thumbnailFromUrl } from "./media";

// RF3-T04: the tools are told the input format, so a file cannot make them open some other kind
// of input. The attack file is an ffconcat script that points at a real video: unpinned, ffprobe
// follows it and reads the video; pinned to mov, the text file is simply refused.

let dir: string;
let video: string;
let script: string;
let textAsImage: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "input-formats-"));
  video = join(dir, "real.mp4");
  const made = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x48:rate=10",
      "-t",
      "1",
      video,
    ],
    { encoding: "utf8" },
  );
  if (made.status !== 0) throw new Error(`ffmpeg failed: ${made.stderr}`);
  script = join(dir, "sneaky.mp4");
  await writeFile(script, `ffconcat version 1.0\nfile '${video}'\n`);
  textAsImage = join(dir, "sneaky.png");
  await writeFile(textAsImage, `ffconcat version 1.0\nfile '${video}'\n`);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describeWithFfmpeg("input formats (RF3-T04)", () => {
  it("control: without a pinned format ffprobe follows the script to the video", () => {
    const run = spawnSync(
      "ffprobe",
      ["-v", "error", "-safe", "0", "-show_streams", "-of", "json", script],
      { encoding: "utf8" },
    );
    expect(run.stdout).toContain('"codec_type": "video"');
  });

  it("probeFile reads a real MP4", async () => {
    const facts = await probeFile(video);
    expect(facts?.width).toBe(64);
  });

  it("probeFile refuses a text file named .mp4 without opening what it names", async () => {
    // Refused as a failed tool run or as no usable video: never facts from the named video.
    const facts = await probeFile(script).catch((error: unknown) => {
      expect(error).toBeInstanceOf(MediaToolError);
      return null;
    });
    expect(facts).toBeNull();
  });

  it("the thumbnail refuses it too", async () => {
    await expect(
      thumbnailFromUrl(script, { durationMs: 1000, hdrTransfer: null }, "input-formats"),
    ).rejects.toBeInstanceOf(MediaToolError);
  });

  it("probeImageFile refuses a text file named .png and reads a real PNG", async () => {
    expect(await probeImageFile(textAsImage, 40_000_000)).toBeNull();
    const png = join(dir, "real.png");
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-frames:v", "1", png]);
    const facts = await probeImageFile(png, 40_000_000);
    expect(facts).toMatchObject({ width: 64, height: 48, format: "png_pipe" });
  });
});

it("picks the image demuxer from the first bytes", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  expect(imageDemuxer(png)).toBe("png_pipe");
  expect(imageDemuxer(jpeg)).toBe("jpeg_pipe");
  expect(imageDemuxer(webp)).toBe("webp_pipe");
  expect(imageDemuxer(new TextEncoder().encode("ffconcat version 1.0"))).toBeNull();
  expect(imageInput(new Uint8Array(0))).toBeNull();
  expect(imageInput(png)).toEqual(["-f", "png_pipe"]);
});
