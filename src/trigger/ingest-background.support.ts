import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";
import { beginProcessing, createBackgroundUpload } from "@/db/data/backgrounds";
import { background } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import type { R2 } from "@/lib/r2";
import { type IngestIo, ingestBackground, realIo } from "./ingest-background";
import { statSync as nodeStat } from "node:fs";

// Spec 0008, Pipeline step 5 (AC-8 to AC-10): the ingest of an uploaded background, with the
// real ffprobe and ffmpeg on tiny generated images and a stand in for R2 (files in a folder).

export let testDb: TestDb;
export let db: Db;
export let work: string;

/** Opens the test database and a work folder before the file's tests; removes both after. */
export function registerDb() {
  beforeAll(async () => {
    testDb = await openTestDb();
    db = testDb.db;
    work = await mkdtemp(join(tmpdir(), "ingest-test-"));
  });
  afterAll(async () => {
    await testDb?.close();
    await rm(work, { recursive: true, force: true });
  });
}

export const ffmpeg = (args: string[]) => {
  const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
};

/** A stand in for R2 and the Worker: sources by key, outputs collected, real image tools. */
export function setup(source: { path: string; declared?: number | undefined } | null) {
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

export const statSync = (path: string) => nodeStat(path).size;

export async function processing(creatorId: string, bytes: number) {
  const made = await createBackgroundUpload(db, { creatorId, name: "Wall", bytes });
  if (!made.ok) throw new Error(made.error);
  await beginProcessing(db, creatorId, made.data.id);
  return made.data.id;
}

export async function run(file: string, declared?: number) {
  const creator = await createCreator(db);
  const id = await processing(creator.id, declared ?? (await stat(file)).size);
  const dir = await mkdtemp(join(work, "job-"));
  const s = setup({ path: file });
  const result = await ingestBackground(db, id, s.io, dir, new AbortController().signal);
  const [row] = await db.select().from(background).where(eq(background.id, id));
  return { result, row, s, creator, id, dir };
}

export const dims = (path: string) => {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  const [w, h] = probe.stdout.trim().split(",").map(Number);
  return { width: w ?? 0, height: h ?? 0 };
};

/** One pixel of an image as [r, g, b]. */
export const pixel = (path: string, x: number, y: number) => {
  const out = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `crop=2:2:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"],
    { encoding: "buffer" },
  );
  return [...out.stdout.subarray(0, 3)];
};

export const image = async (name: string, args: string[]) => {
  const path = join(work, name);
  ffmpeg(args.concat(path));
  return path;
};

/** A JPEG with an EXIF orientation (6 means turned a quarter, so it displays rotated). */
export async function withOrientation(source: string, name: string, orientation: number) {
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
