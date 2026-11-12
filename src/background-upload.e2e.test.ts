import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { background, storageDeletion } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { backgroundKeys } from "@/lib/background-rules";
import { downloadToFile } from "@/lib/r2-file-upload";
import type { R2 } from "@/lib/r2";
import { listBackgrounds } from "@/server/backgrounds/library";
import {
  completeBackground,
  createBackground,
  removeBackground,
} from "@/server/backgrounds/upload";
import { type IngestIo, ingestBackground, realIo } from "@/trigger/ingest-background";
import { describeWithFfmpeg } from "@/test/ffmpeg";

// Spec 0008, AC-8 to AC-10, end to end without real R2: the routes' functions, the real database,
// the real ffprobe and ffmpeg, and a small HTTP server standing in for R2. The stand in is used
// the way R2 is: a presigned PUT whose content type and exact length are checked, a HEAD for the
// size, and the ingest reading the source through a URL with the real download code. The real R2
// path is covered by the pipeline run (S3S-T07).

let testDb: TestDb;
let db: Db;
let dir: string;
let server: Server;
let base = "";
const objects = new Map<string, { body: Buffer; type: string }>();

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
  dir = await mkdtemp(join(tmpdir(), "r2-standin-"));
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const key = decodeURIComponent(url.pathname.slice(1));
    if (req.method === "PUT") {
      // Like a presigned PUT: the signed content type and exact length must match.
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const type = req.headers["content-type"] ?? "";
        if (
          type !== url.searchParams.get("type") ||
          body.length !== Number(url.searchParams.get("bytes"))
        ) {
          res.writeHead(403).end("signature does not match");
          return;
        }
        objects.set(key, { body, type });
        res.writeHead(200).end();
      });
      return;
    }
    const found = objects.get(key);
    if (!found) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": found.type, "content-length": found.body.length });
    res.end(req.method === "HEAD" ? undefined : found.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await testDb?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const ffmpeg = (args: string[]) => {
  const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
};

/** The same ports the real routes use, with R2 replaced by the stand in over HTTP. */
function ports() {
  return {
    db,
    presignPut: async (key: string, contentType: string, bytes: number) =>
      `${base}/${key}?type=${encodeURIComponent(contentType)}&bytes=${bytes}`,
    headObject: async (key: string) => {
      const res = await fetch(`${base}/${key}`, { method: "HEAD" });
      return res.ok ? { size: Number(res.headers.get("content-length")) } : null;
    },
    triggerIngest: async (id: string) => {
      const work = await mkdtemp(join(dir, "job-"));
      const real = realIo({} as R2);
      const io: IngestIo = {
        ...real,
        head: ports().headObject,
        presignGet: async (key) => `${base}/${key}`,
        download: (url, path, signal) => downloadToFile(url, path, signal),
        put: async (key, path, contentType) => {
          const bytes = await readFile(path);
          const res = await fetch(
            `${base}/${key}?type=${encodeURIComponent(contentType)}&bytes=${bytes.length}`,
            {
              method: "PUT",
              headers: { "content-type": contentType },
              body: bytes,
            },
          );
          if (!res.ok) throw new Error(`stand in put failed: ${res.status}`);
        },
      };
      await ingestBackground(db, id, io, work, new AbortController().signal);
    },
  };
}

describeWithFfmpeg("upload, ingest and delete through a stand in for R2", () => {
  it("takes a turned JPEG from the signed PUT to a ready background, then deletes it with its files", async () => {
    const photo = join(dir, "photo.jpg");
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=2560x1440:d=1", "-frames:v", "1", photo]);
    // EXIF orientation 6: the file is landscape but displays portrait.
    const data = await readFile(photo);
    const exif = Buffer.concat([
      Buffer.from("Exif\0\0II*\0", "latin1"),
      Buffer.from([8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(exif.length + 2);
    const jpeg = Buffer.concat([
      data.subarray(0, 2),
      Buffer.from([0xff, 0xe1]),
      length,
      exif,
      data.subarray(2),
    ]);

    const creator = await createCreator(db);
    const made = await createBackground(ports(), creator.id, {
      name: "Office wall",
      contentType: "image/jpeg",
      bytes: jpeg.length,
    });
    if (!made.ok) throw new Error(made.error);
    const keys = backgroundKeys(creator.id, made.data.id);

    // The browser's PUT: the link only accepts the type and the exact length it was signed for.
    const wrongType = await fetch(made.data.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: jpeg,
    });
    expect(wrongType.status).toBe(403);
    const wrongLength = await fetch(made.data.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg.subarray(1),
    });
    expect(wrongLength.status).toBe(403);
    // Nothing stored yet, so completing is refused and the row stays uploading.
    expect(await completeBackground(ports(), creator.id, made.data.id)).toEqual({
      ok: false,
      error: "not_uploaded",
    });
    const put = await fetch(made.data.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    });
    expect(put.status).toBe(200);

    const done = await completeBackground(ports(), creator.id, made.data.id);
    expect(done).toEqual({ ok: true, data: { status: "processing" } });
    const [row] = await db.select().from(background).where(eq(background.id, made.data.id));
    // 2560 by 1440 turned upright is 1440 by 2560, fitted inside 3840 by 2160: 1215 by 2160.
    expect(row).toMatchObject({
      status: "ready",
      imageKey: keys.imageKey,
      thumbKey: keys.thumbKey,
      width: 1215,
      height: 2160,
    });
    expect(objects.get(keys.imageKey)?.type).toBe("image/jpeg");
    expect(objects.get(keys.thumbKey)?.type).toBe("image/webp");

    const listed = await listBackgrounds(db, creator.id, async (key) => `${base}/${key}`);
    expect(listed.mine.map((b) => [b.name, b.status, b.thumbUrl !== null])).toEqual([
      ["Office wall", "ready", true],
    ]);
    const thumb = await fetch(listed.mine[0]!.thumbUrl!);
    expect(thumb.status).toBe(200);

    const removed = await removeBackground({ db }, creator.id, made.data.id);
    expect(removed.ok).toBe(true);
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toEqual(expect.arrayContaining([keys.sourceKey, keys.imageKey, keys.thumbKey]));
  });
});
