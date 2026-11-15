import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { background, storageDeletion } from "@/db/schema";
import { createCreator } from "@/db/testing/test-db";
import { backgroundKeys } from "@/lib/background-rules";
import { type IngestIo, ingestBackground } from "./ingest-background";
import { setup, processing, db, work, registerDb } from "./ingest-background.support";

registerDb();

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
