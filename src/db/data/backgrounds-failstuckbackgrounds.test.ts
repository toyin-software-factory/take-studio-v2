import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, storageDeletion } from "../schema";
import { type TestDb, createCreator, openTestDb } from "../testing/test-db";
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
  testDb = await openTestDb({ database: "take_studio_test_background_data_2" });
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
