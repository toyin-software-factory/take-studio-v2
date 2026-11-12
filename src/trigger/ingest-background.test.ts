import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginProcessing, createBackgroundUpload } from "@/db/data/backgrounds";
import { background, storageDeletion } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { backgroundKeys } from "@/lib/background-rules";
import type { R2 } from "@/lib/r2";
import { type IngestIo, ingestBackground, realIo } from "./ingest-background";
import { describeWithFfmpeg } from "@/test/ffmpeg";

// Spec 0008, Pipeline step 5 (AC-8 to AC-10): the ingest of an uploaded background, with the
// real ffprobe and ffmpeg on tiny generated images and a stand in for R2 (files in a folder).

let testDb: TestDb;
let db: Db;
let work: string;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
  work = await mkdtemp(join(tmpdir(), "ingest-test-"));
});
afterAll(async () => {
  await testDb?.close();
  await rm(work, { recursive: true, force: true });
});

const ffmpeg = (args: string[]) => {
  const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
};

/** A stand in for R2 and the Worker: sources by key, outputs collected, real image tools. */
function setup(source: { path: string; declared?: number | undefined } | null) {
  const real = realIo({} as R2);
  const written = new Map<string, string>();
  let converted = 0;
  const io: IngestIo = {
    head: async () => (source ? { size: statSync(source.path) } : null),
    presignGet: async (key) => key,
    download: async (_url, path) => {
      if (!source) throw new Error("no source");
      await copyFile(source.path, path);
      return statSync(source.path);
    },
    readHead: real.readHead,
    probe: real.probe,
    convert: async (...args) => {
      converted += 1;
      await real.convert(...args);
    },
    put: async (key, path) => {
      const copy = join(work, `out-${crypto.randomUUID()}`);
      await copyFile(path, copy);
      written.set(key, copy);
    },
  };
  return { io, written, converted: () => converted };
}

import { statSync as nodeStat } from "node:fs";
const statSync = (path: string) => nodeStat(path).size;

async function processing(creatorId: string, bytes: number) {
  const made = await createBackgroundUpload(db, { creatorId, name: "Wall", bytes });
  if (!made.ok) throw new Error(made.error);
  await beginProcessing(db, creatorId, made.data.id);
  return made.data.id;
}

async function run(file: string, declared?: number) {
  const creator = await createCreator(db);
  const id = await processing(creator.id, declared ?? (await stat(file)).size);
  const dir = await mkdtemp(join(work, "job-"));
  const s = setup({ path: file });
  const result = await ingestBackground(db, id, s.io, dir, new AbortController().signal);
  const [row] = await db.select().from(background).where(eq(background.id, id));
  return { result, row, s, creator, id, dir };
}

const dims = (path: string) => {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  const [w, h] = probe.stdout.trim().split(",").map(Number);
  return { width: w ?? 0, height: h ?? 0 };
};

/** One pixel of an image as [r, g, b]. */
const pixel = (path: string, x: number, y: number) => {
  const out = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `crop=2:2:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"],
    { encoding: "buffer" },
  );
  return [...out.stdout.subarray(0, 3)];
};

const image = async (name: string, args: string[]) => {
  const path = join(work, name);
  ffmpeg(args.concat(path));
  return path;
};

/** A JPEG with an EXIF orientation (6 means turned a quarter, so it displays rotated). */
async function withOrientation(source: string, name: string, orientation: number) {
  const data = await readFile(source);
  const tiff = Buffer.concat([
    Buffer.from("II*\0", "latin1"),
    Buffer.from([8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]),
  ]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(exif.length + 2);
  const path = join(work, name);
  await writeFile(
    path,
    Buffer.concat([data.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, exif, data.subarray(2)]),
  );
  return path;
}

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

describe("ingest rules that need no image tools", () => {
  const noTools = (source: { path: string } | null) => {
    const s = setup(source);
    return s;
  };

  it("refuses a file larger than the size declared (image_too_large), before downloading it", async () => {
    const creator = await createCreator(db);
    const id = await processing(creator.id, 100);
    const file = join(work, "bigger-than-declared.bin");
    await writeFile(file, Buffer.alloc(500));
    const s = noTools({ path: file });
    let downloaded = false;
    const io: IngestIo = { ...s.io, download: async () => ((downloaded = true), 0) };
    const result = await ingestBackground(db, id, io, work, new AbortController().signal);
    expect(result).toEqual({ outcome: "refused", code: "image_too_large" });
    expect(downloaded).toBe(false);
  });

  it("refuses a file over 10 MiB even if the declared size says so", async () => {
    const creator = await createCreator(db);
    const id = await processing(creator.id, 20 * 1024 * 1024);
    const s = noTools({ path: join(work, "ten-plus.bin") });
    await writeFile(join(work, "ten-plus.bin"), Buffer.alloc(11 * 1024 * 1024));
    const result = await ingestBackground(db, id, s.io, work, new AbortController().signal);
    expect(result).toEqual({ outcome: "refused", code: "image_too_large" });
  });

  it("refuses with upload_incomplete when the source is not stored", async () => {
    const creator = await createCreator(db);
    const id = await processing(creator.id, 1000);
    const result = await ingestBackground(
      db,
      id,
      noTools(null).io,
      work,
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: "refused", code: "upload_incomplete" });
  });

  it("does nothing for a deleted row, or one that is not processing", async () => {
    const creator = await createCreator(db);
    const id = await processing(creator.id, 1000);
    await db.update(background).set({ status: "failed" }).where(eq(background.id, id));
    const s = noTools(null);
    expect(await ingestBackground(db, id, s.io, work, new AbortController().signal)).toEqual({
      outcome: "skipped",
    });
    expect(
      await ingestBackground(db, crypto.randomUUID(), s.io, work, new AbortController().signal),
    ).toEqual({ outcome: "skipped" });
  });

  it("writes nothing and queues the files when the row is deleted while it works (AC-10)", async () => {
    const creator = await createCreator(db);
    const id = await processing(creator.id, 1000);
    const keys = backgroundKeys(creator.id, id);
    const file = join(work, "fake.jpg");
    await writeFile(file, Buffer.alloc(1000));
    const wrote: string[] = [];
    const io: IngestIo = {
      head: async () => ({ size: 1000 }),
      presignGet: async (key) => key,
      download: async (_u, path) => (await copyFile(file, path), 1000),
      readHead: async () => new Uint8Array(0),
      probe: async () => ({
        codec: "mjpeg",
        width: 1920,
        height: 1080,
        frames: 1,
        rotation: 0,
        format: "image2",
      }),
      convert: async (_s, dir) => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "image.jpg"), "x");
        await writeFile(join(dir, "thumb.webp"), "y");
      },
      put: async (key) => {
        wrote.push(key);
        // The creator deletes the background while the files are being written.
        await db.delete(background).where(eq(background.id, id));
      },
    };
    const dir = await mkdtemp(join(work, "gone-"));
    const result = await ingestBackground(db, id, io, dir, new AbortController().signal);
    expect(result).toEqual({ outcome: "gone" });
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(0);
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toEqual(expect.arrayContaining([keys.sourceKey, keys.imageKey, keys.thumbKey]));
  });
});

describe("ingest writes after a deletion or a deadline", () => {
  async function failingPut(deleteFirst: boolean) {
    const creator = await createCreator(db);
    const id = await processing(creator.id, 1000);
    const keys = backgroundKeys(creator.id, id);
    const file = join(work, `src-${id}.jpg`);
    await writeFile(file, Buffer.alloc(1000));
    const signals: AbortSignal[] = [];
    const io: IngestIo = {
      head: async () => ({ size: 1000 }),
      presignGet: async (key) => key,
      download: async (_u, path) => (await copyFile(file, path), 1000),
      readHead: async () => new Uint8Array(0),
      probe: async () => ({
        codec: "mjpeg",
        width: 1920,
        height: 1080,
        frames: 1,
        rotation: 0,
        format: "image2",
      }),
      convert: async (_s, dir) => {
        await writeFile(join(dir, "image.jpg"), "x");
        await writeFile(join(dir, "thumb.webp"), "y");
      },
      put: async (key, _path, _type, signal) => {
        signals.push(signal);
        if (key === keys.imageKey && deleteFirst)
          await db.delete(background).where(eq(background.id, id));
        if (key === keys.thumbKey) throw new Error("storage down");
      },
    };
    const dir = await mkdtemp(join(work, "fail-"));
    const controller = new AbortController();
    const outcome = await ingestBackground(db, id, io, dir, controller.signal).then(
      () => "returned",
      (error: Error) => error.message,
    );
    return { outcome, keys, signals, controller };
  }

  it("queues the files when the thumbnail write fails after the background was deleted", async () => {
    const { outcome, keys } = await failingPut(true);
    expect(outcome).toBe("storage down");
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toEqual(expect.arrayContaining([keys.sourceKey, keys.imageKey, keys.thumbKey]));
  });

  it("queues nothing when the row still exists, because a retry overwrites the files", async () => {
    const { outcome, keys } = await failingPut(false);
    expect(outcome).toBe("storage down");
    // Only this background's keys count: other test files share the table and run at the same time.
    const mine = (await db.select().from(storageDeletion))
      .map((r) => r.objectKey)
      .filter((key) => [keys.sourceKey, keys.imageKey, keys.thumbKey].includes(key));
    expect(mine).toEqual([]);
  });

  it("hands the job's own signal to every output write", async () => {
    const { signals, controller } = await failingPut(false);
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) expect(signal).toBe(controller.signal);
  });
});
