import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { run, image, work, registerDb } from "./ingest-background.support";

registerDb();

describeWithFfmpeg("ingest with the real image tools", () => {
  it("refuses an image under 1280 by 720", async () => {
    const file = await image("tiny.png", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1000x600:d=1",
      "-frames:v",
      "1",
    ]);
    const { row, s } = await run(file);
    expect(row).toMatchObject({ status: "failed", failureCode: "image_too_small" });
    expect(s.converted()).toBe(0);
  });

  it("refuses over 40 megapixels before decoding it (a decompression bomb)", async () => {
    // 8000 by 6000 is 48 megapixels; a flat colour compresses to a few KB.
    const file = await image("bomb.png", [
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=8000x6000:d=1",
      "-frames:v",
      "1",
    ]);
    expect((await stat(file)).size).toBeLessThan(200_000);
    const { row, s } = await run(file);
    expect(row).toMatchObject({ status: "failed", failureCode: "image_too_large" });
    expect(s.converted()).toBe(0);
  });

  it("refuses animated images: WebP, APNG", async () => {
    const webp = await image("anim.webp", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1600x900:d=1:r=5",
      "-c:v",
      "libwebp_anim",
      "-loop",
      "0",
    ]);
    const apng = await image("anim.apng", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1600x900:d=1:r=5",
      "-f",
      "apng",
      "-plays",
      "0",
    ]);
    for (const file of [webp, apng]) {
      const { row, s } = await run(file);
      expect(row).toMatchObject({ status: "failed", failureCode: "image_animated" });
      expect(s.converted()).toBe(0);
    }
  });

  it("refuses files that are not a JPEG, PNG or WebP (image_invalid)", async () => {
    const gif = await image("a.gif", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1600x900:d=1",
      "-frames:v",
      "1",
    ]);
    const text = join(work, "not-an-image.jpg");
    await writeFile(text, "this is not an image at all");
    const pdf = join(work, "doc.png");
    await writeFile(pdf, Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"));
    for (const file of [gif, text, pdf]) {
      const { row } = await run(file);
      expect(row).toMatchObject({ status: "failed", failureCode: "image_invalid" });
    }
  });

  it("refuses a video container that holds a single MJPEG frame (image_invalid)", async () => {
    const avi = await image("one-frame.avi", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1600x900:d=1",
      "-frames:v",
      "1",
      "-c:v",
      "mjpeg",
    ]);
    const { row, s } = await run(avi);
    expect(row).toMatchObject({ status: "failed", failureCode: "image_invalid" });
    expect(s.converted()).toBe(0);
  });

  it("accepts a WebP still", async () => {
    const file = await image("still.webp", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1600x900:d=1",
      "-frames:v",
      "1",
      "-c:v",
      "libwebp",
    ]);
    expect((await run(file)).row?.status).toBe("ready");
  });
});
