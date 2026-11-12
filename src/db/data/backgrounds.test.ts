import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, backgroundPreview, processingJob, storageDeletion, user } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import {
  beginProcessing,
  createBackgroundUpload,
  deleteBackground,
  deleteCreatorBackgrounds,
  failIngest,
  failStuckBackgrounds,
  purgeRemovedBackgrounds,
  saveIngest,
} from "./backgrounds";
import { backgroundKeys } from "@/lib/background-rules";

// Spec 0008, AC-8 to AC-10: uploaded backgrounds in the database.
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  // The stuck row sweep scans every stale row, so this suite owns its database.
  testDb = await openTestDb({ database: "take_studio_test_background_data" });
  db = testDb.db;
  // Rows from earlier runs would crowd the sweep's batch of 50, so start from none.
  await db.delete(background);
});
afterAll(() => testDb?.close());

const queued = async () => (await db.select().from(storageDeletion)).map((r) => r.objectKey);

async function start(creatorId: string, extra: { now?: Date } = {}) {
  const made = await createBackgroundUpload(db, { creatorId, name: "Wall", bytes: 1000, ...extra });
  if (!made.ok) throw new Error(made.error);
  return made.data;
}

async function ready(creatorId: string) {
  const { id } = await start(creatorId);
  await beginProcessing(db, creatorId, id);
  const keys = backgroundKeys(creatorId, id);
  await saveIngest(db, id, {
    imageKey: keys.imageKey,
    thumbKey: keys.thumbKey,
    width: 1920,
    height: 1080,
  });
  return { id, keys };
}

describe("createBackgroundUpload", () => {
  it("creates an uploading row with its source key and the declared size", async () => {
    const creator = await createCreator(db);
    const made = await start(creator.id);
    expect(made.sourceKey).toBe(backgroundKeys(creator.id, made.id).sourceKey);
    const [row] = await db.select().from(background).where(eq(background.id, made.id));
    expect(row).toMatchObject({
      status: "uploading",
      creatorId: creator.id,
      bytes: 1000,
      name: "Wall",
    });
  });

  it("allows 20 starts per hour, failed ones included, then answers rate_limited", async () => {
    const creator = await createCreator(db);
    const now = new Date();
    for (let i = 0; i < 20; i += 1) await start(creator.id, { now });
    const over = await createBackgroundUpload(db, {
      creatorId: creator.id,
      name: "x",
      bytes: 1,
      now,
    });
    expect(over).toEqual({ ok: false, error: "rate_limited" });
    // An hour later the window has moved on.
    const later = new Date(now.getTime() + 3_700_000);
    expect(
      (await createBackgroundUpload(db, { creatorId: creator.id, name: "x", bytes: 1, now: later }))
        .ok,
    ).toBe(true);
  });

  it("refuses a 101st background with library_full", async () => {
    const creator = await createCreator(db);
    await db.insert(background).values(
      Array.from({ length: 100 }, (_, i) => ({
        id: crypto.randomUUID(),
        creatorId: creator.id,
        name: `Old ${i}`,
        status: "failed",
        createdAt: new Date(Date.now() - 2 * 3_600_000),
      })),
    );
    const res = await createBackgroundUpload(db, { creatorId: creator.id, name: "x", bytes: 1 });
    expect(res).toEqual({ ok: false, error: "library_full" });
  });
});

describe("beginProcessing", () => {
  it("moves uploading to processing once, and refuses another creator's or a second call", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const { id } = await start(creator.id);
    expect(await beginProcessing(db, other.id, id)).toEqual({ ok: false, error: "not_found" });
    expect((await beginProcessing(db, creator.id, id)).ok).toBe(true);
    expect(await beginProcessing(db, creator.id, id)).toEqual({ ok: false, error: "not_uploaded" });
  });
});

describe("saveIngest and failIngest", () => {
  it("makes a processing row ready with its files and size", async () => {
    const creator = await createCreator(db);
    const { id, keys } = await ready(creator.id);
    const [row] = await db.select().from(background).where(eq(background.id, id));
    expect(row).toMatchObject({
      status: "ready",
      imageKey: keys.imageKey,
      thumbKey: keys.thumbKey,
      width: 1920,
      height: 1080,
    });
  });

  it("writes nothing for a deleted row, or one cleanup already failed", async () => {
    const creator = await createCreator(db);
    const { id } = await start(creator.id);
    await beginProcessing(db, creator.id, id);
    await db.update(background).set({ status: "failed" }).where(eq(background.id, id));
    const k = backgroundKeys(creator.id, id);
    expect(
      (
        await saveIngest(db, id, {
          imageKey: k.imageKey,
          thumbKey: k.thumbKey,
          width: 1,
          height: 1,
        })
      ).ok,
    ).toBe(false);
    await db.delete(background).where(eq(background.id, id));
    expect(
      (
        await saveIngest(db, id, {
          imageKey: k.imageKey,
          thumbKey: k.thumbKey,
          width: 1,
          height: 1,
        })
      ).ok,
    ).toBe(false);
  });

  it("fails only a processing row, with the code", async () => {
    const creator = await createCreator(db);
    const { id } = await start(creator.id);
    expect(await failIngest(db, id, "image_invalid")).toBe(false); // still uploading
    await beginProcessing(db, creator.id, id);
    expect(await failIngest(db, id, "image_too_small")).toBe(true);
    const [row] = await db.select().from(background).where(eq(background.id, id));
    expect(row).toMatchObject({ status: "failed", failureCode: "image_too_small" });
  });
});

describe("deleteBackground (AC-9, AC-10)", () => {
  it("removes the row and queues its three files and its preview stills", async () => {
    const creator = await createCreator(db);
    const { id, keys } = await ready(creator.id);
    const t = await seedTake(db, creator.id);
    await db.insert(backgroundPreview).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      backgroundId: id,
      cutVersion: "v1",
      status: "ready",
      objectKey: `previews/${t.id}/${id}.jpg`,
    });
    expect(await deleteBackground(db, creator.id, id)).toEqual({ ok: true, data: undefined });
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(0);
    const keysQueued = await queued();
    for (const key of [
      keys.sourceKey,
      keys.imageKey,
      keys.thumbKey,
      `previews/${t.id}/${id}.jpg`,
    ]) {
      expect(keysQueued).toContain(key);
    }
  });

  it("is not found for another creator's background, a built in and a missing one", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const theirs = await ready(other.id);
    const builtIn = crypto.randomUUID();
    await db.insert(background).values({
      id: builtIn,
      creatorId: null,
      name: "Built in",
      status: "ready",
      imageKey: "b/i.jpg",
      thumbKey: "b/t.webp",
      width: 1920,
      height: 1080,
    });
    for (const id of [theirs.id, builtIn, crypto.randomUUID()]) {
      expect(await deleteBackground(db, creator.id, id)).toEqual({ ok: false, error: "not_found" });
    }
    expect(await db.select().from(background).where(eq(background.id, theirs.id))).toHaveLength(1);
    await db.delete(background).where(eq(background.id, builtIn));
  });

  it("is refused (in_use) while a queued or running job targets it, and works once it is final", async () => {
    const creator = await createCreator(db);
    const { id } = await ready(creator.id);
    const t = await seedTake(db, creator.id, { status: "ready" });
    const jobId = crypto.randomUUID();
    await db.insert(processingJob).values({
      id: jobId,
      takeId: t.id,
      kind: "rerender",
      status: "running",
      secondsCharged: 0,
      targetBackgroundId: id,
    });
    expect(await deleteBackground(db, creator.id, id)).toEqual({ ok: false, error: "in_use" });
    await db.update(processingJob).set({ status: "queued" }).where(eq(processingJob.id, jobId));
    expect(await deleteBackground(db, creator.id, id)).toEqual({ ok: false, error: "in_use" });
    await db.update(processingJob).set({ status: "succeeded" }).where(eq(processingJob.id, jobId));
    expect((await deleteBackground(db, creator.id, id)).ok).toBe(true);
  });

  it("clears the creator's default and a take's background, which keep their other data", async () => {
    const creator = await createCreator(db);
    const { id } = await ready(creator.id);
    const t = await seedTake(db, creator.id, { backgroundId: id });
    await db.update(user).set({ defaultBackgroundId: id }).where(eq(user.id, creator.id));
    await deleteBackground(db, creator.id, id);
    expect(
      (await db.select().from(user).where(eq(user.id, creator.id)))[0]?.defaultBackgroundId,
    ).toBeNull();
    expect((await seedTakeRow(t.id))?.backgroundId).toBeNull();
  });
});

async function seedTakeRow(id: string) {
  const { take } = await import("../schema");
  return (await db.select().from(take).where(eq(take.id, id)))[0];
}

describe("failStuckBackgrounds (AC-8)", () => {
  it("fails uploading and processing rows older than an hour and queues their files", async () => {
    const creator = await createCreator(db);
    const old = new Date(Date.now() - 2 * 3_600_000);
    const stale = await start(creator.id);
    const slow = await start(creator.id);
    await beginProcessing(db, creator.id, slow.id);
    const fresh = await start(creator.id);
    await db.update(background).set({ updatedAt: old }).where(eq(background.id, stale.id));
    await db.update(background).set({ updatedAt: old }).where(eq(background.id, slow.id));
    const failed = await failStuckBackgrounds(db, new Date());
    expect(failed).toBeGreaterThanOrEqual(2);
    const rows = await db.select().from(background).where(eq(background.creatorId, creator.id));
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by(stale.id)).toMatchObject({ status: "failed", failureCode: "upload_incomplete" });
    expect(by(slow.id)).toMatchObject({ status: "failed", failureCode: "ingest_error" });
    expect(by(fresh.id)?.status).toBe("uploading");
    expect(await queued()).toContain(backgroundKeys(creator.id, stale.id).sourceKey);
  });

  it("leaves ready and failed rows alone", async () => {
    const creator = await createCreator(db);
    const { id } = await ready(creator.id);
    await db
      .update(background)
      .set({ updatedAt: new Date(Date.now() - 5 * 3_600_000) })
      .where(eq(background.id, id));
    await failStuckBackgrounds(db, new Date());
    expect((await db.select().from(background).where(eq(background.id, id)))[0]?.status).toBe(
      "ready",
    );
  });
});

describe("deleteCreatorBackgrounds (account deletion)", () => {
  it("deletes every row of the creator and queues all their files, leaving others alone", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const a = await ready(creator.id);
    const b = await start(creator.id);
    const theirs = await ready(other.id);
    const count = await db.transaction((tx) => deleteCreatorBackgrounds(tx, creator.id));
    expect(count).toBe(2);
    const queuedKeys = await queued();
    expect(queuedKeys).toContain(a.keys.imageKey);
    expect(queuedKeys).toContain(backgroundKeys(creator.id, b.id).sourceKey);
    expect(queuedKeys).not.toContain(theirs.keys.imageKey);
    expect(
      await db.select().from(background).where(eq(background.creatorId, creator.id)),
    ).toHaveLength(0);
    expect(await db.select().from(background).where(eq(background.id, theirs.id))).toHaveLength(1);
  });
});

describe("deleting an upload whose link may still be live", () => {
  const keysOf = (creatorId: string, id: string) => Object.values(backgroundKeys(creatorId, id));
  const count = async (key: string) => (await queued()).filter((k) => k === key).length;

  it("keeps a hidden tombstone for a young uploading row, then purges it and queues the keys again", async () => {
    const creator = await createCreator(db);
    const { id } = await start(creator.id);
    const now = new Date();
    expect(await deleteBackground(db, creator.id, id, now)).toEqual({ ok: true, data: undefined });
    // Hidden, not gone: failed with `removed`, and the keys are queued once already.
    const [tomb] = await db.select().from(background).where(eq(background.id, id));
    expect(tomb).toMatchObject({ status: "failed", failureCode: "removed" });
    const source = backgroundKeys(creator.id, id).sourceKey;
    expect(await count(source)).toBe(1);
    // Too early to purge: a PUT sent with the link could still land.
    // (The count is not asserted: this database keeps other runs' tombstones, which may be due.)
    await purgeRemovedBackgrounds(db, new Date(now.getTime() + 10 * 60_000));
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(1);
    // After the link has expired (15 minutes and a margin): queued again, row deleted.
    const later = new Date(now.getTime() + 21 * 60_000);
    await db.update(background).set({ updatedAt: now }).where(eq(background.id, id));
    expect(await purgeRemovedBackgrounds(db, later)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(0);
    expect(await count(source)).toBe(2);
    for (const key of keysOf(creator.id, id)) expect(await queued()).toContain(key);
  });

  it("deletes at once when the link cannot be live: an old upload, a processing row, a ready one", async () => {
    const creator = await createCreator(db);
    const old = await start(creator.id);
    const processing = await start(creator.id);
    await beginProcessing(db, creator.id, processing.id);
    const done = await ready(creator.id);
    await db
      .update(background)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(background.id, old.id));
    for (const id of [old.id, processing.id, done.id]) {
      expect(await deleteBackground(db, creator.id, id)).toEqual({ ok: true, data: undefined });
      expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(0);
    }
  });

  it("refuses to complete or process a removed tombstone", async () => {
    const creator = await createCreator(db);
    const { id } = await start(creator.id);
    await deleteBackground(db, creator.id, id);
    expect(await beginProcessing(db, creator.id, id)).toEqual({ ok: false, error: "not_uploaded" });
  });

  it("leaves other failed rows alone when purging", async () => {
    const creator = await createCreator(db);
    const { id } = await start(creator.id);
    await beginProcessing(db, creator.id, id);
    await failIngest(db, id, "image_invalid");
    await db
      .update(background)
      .set({ updatedAt: new Date(Date.now() - 5 * 3_600_000) })
      .where(eq(background.id, id));
    await purgeRemovedBackgrounds(db, new Date());
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(1);
  });
});
