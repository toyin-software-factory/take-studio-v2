import { expect, it } from "vitest";
import { backgroundKeys } from "@/lib/background-rules";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { run, dims, pixel, image, withOrientation, registerDb } from "./ingest-background.support";

registerDb();

describeWithFfmpeg("ingest with the real image tools", () => {
  it("makes a JPEG ready: image.jpg and a 480 by 270 thumb.webp, with the stored size", async () => {
    const file = await image("ok.jpg", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1920x1080:d=1",
      "-frames:v",
      "1",
    ]);
    const { result, row, s } = await run(file);
    expect(result).toEqual({ outcome: "ready" });
    const keys = backgroundKeys(row!.creatorId!, row!.id);
    expect(row).toMatchObject({
      status: "ready",
      imageKey: keys.imageKey,
      thumbKey: keys.thumbKey,
      width: 1920,
      height: 1080,
    });
    expect(dims(s.written.get(keys.imageKey)!)).toEqual({ width: 1920, height: 1080 });
    expect(dims(s.written.get(keys.thumbKey)!)).toEqual({ width: 480, height: 270 });
  });

  it("fits a large image inside 3840 by 2160 without changing its shape, and never enlarges", async () => {
    const file = await image("big.jpg", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=5000x3000:d=1",
      "-frames:v",
      "1",
    ]);
    const { row, s } = await run(file);
    expect(row?.status).toBe("ready");
    expect(dims(s.written.get(row!.imageKey!)!)).toEqual({ width: 3600, height: 2160 });
    expect({ w: row?.width, h: row?.height }).toEqual({ w: 3600, h: 2160 });
  });

  it("crops the thumbnail to 16:9 from a portrait or square image", async () => {
    const file = await image("square.png", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1500x1500:d=1",
      "-frames:v",
      "1",
    ]);
    const { row, s } = await run(file);
    expect(row?.status).toBe("ready");
    expect(dims(s.written.get(row!.thumbKey!)!)).toEqual({ width: 480, height: 270 });
  });

  it("flattens transparency on black", async () => {
    const clear = await image("clear.png", [
      "-f",
      "lavfi",
      "-i",
      "color=c=red@0.0:s=1600x900:d=1,format=rgba",
      "-frames:v",
      "1",
    ]);
    const half = await image("half.png", [
      "-f",
      "lavfi",
      "-i",
      "color=c=0xff0000@0.5:s=1600x900:d=1,format=rgba",
      "-frames:v",
      "1",
    ]);
    const a = await run(clear);
    const b = await run(half);
    const [r1, g1, b1] = pixel(a.s.written.get(a.row!.imageKey!)!, 800, 450) as [
      number,
      number,
      number,
    ];
    expect(Math.max(r1, g1, b1)).toBeLessThan(25); // fully transparent: black
    const [r2, g2] = pixel(b.s.written.get(b.row!.imageKey!)!, 800, 450) as [number, number];
    expect(r2).toBeGreaterThan(90);
    expect(r2).toBeLessThan(170); // half red over black
    expect(g2).toBeLessThan(40);
  });

  it("applies the EXIF rotation: a turned phone photo comes out upright", async () => {
    const plain = await image("land.jpg", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=2560x1440:d=1",
      "-frames:v",
      "1",
    ]);
    const turned = await withOrientation(plain, "turned.jpg", 6);
    const { result, row, s } = await run(turned);
    expect(result).toEqual({ outcome: "ready" });
    // 2560x1440 turned a quarter displays 1440x2560, then fits inside 3840x2160.
    expect(dims(s.written.get(row!.imageKey!)!)).toEqual({ width: 1215, height: 2160 });
  });

  it("checks the minimum size on the rotated image, not the stored one", async () => {
    const plain = await image("small-land.jpg", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1280x800:d=1",
      "-frames:v",
      "1",
    ]);
    expect((await run(plain)).row?.status).toBe("ready");
    const turned = await withOrientation(plain, "small-turned.jpg", 6);
    const { row } = await run(turned);
    expect(row).toMatchObject({ status: "failed", failureCode: "image_too_small" });
  });
});
