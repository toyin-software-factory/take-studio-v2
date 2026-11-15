import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previewKey } from "@/lib/background-preview";
import { background, backgroundPreview, storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { deleteTakesInTx, expireTake, takeFileKeys } from "./deletion";
import { completePreview, getPreview, loadPreviewWork, requestPreview } from "./previews";
import { built } from "./previews-test-helpers";

/** Spec 0008, build step 4: the preview cache (AC-4). */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(async () => {
  if (testDb) await built.clean(testDb.db);
  await testDb?.close();
});
async function seedBackground(over: Partial<typeof background.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(background)
    .values({
      id,
      creatorId: null,
      name: "Studio",
      imageKey: `backgrounds/builtin/${id}.jpg`,
      thumbKey: `backgrounds/builtin/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
      ...over,
    })
    .returning();
  return built.track(row!);
}
async function readyTake() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  return { creator, take: t };
}
const request = (creatorId: string, takeId: string, backgroundId: string, now?: Date) =>
  requestPreview(db, { creatorId, takeId, backgroundId, now });
const rowOf = async (id: string) =>
  (await db.select().from(backgroundPreview).where(eq(backgroundPreview.id, id)))[0]!;
describe("expiry and the preview (AC-4, AC-18)", () => {
  async function expire(takeId: string) {
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, takeId));
  }

  it("does not serve a ready still of an expired take: original_gone", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    await completePreview(db, { previewId: made.data.preview.id, noGreenScreen: false });
    const before = await getPreview(db, {
      creatorId: creator.id,
      takeId: t.id,
      backgroundId: bg.id,
    });
    expect(before.ok).toBe(true);
    await expire(t.id);
    expect(
      await getPreview(db, { creatorId: creator.id, takeId: t.id, backgroundId: bg.id }),
    ).toEqual({
      ok: false,
      error: "original_gone",
    });
    await db.update(take).set({ status: "expired" }).where(eq(take.id, t.id));
    expect(
      await getPreview(db, { creatorId: creator.id, takeId: t.id, backgroundId: bg.id }),
    ).toEqual({
      ok: false,
      error: "original_gone",
    });
  });

  it("gives the job no work for an expired take", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    await expire(t.id);
    expect(await loadPreviewWork(db, made.data.preview.id)).toBeNull();
  });

  it("completePreview after expiry is gone, so the job removes its file", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    await expire(t.id);
    expect(
      await completePreview(db, { previewId: made.data.preview.id, noGreenScreen: false }),
    ).toEqual({
      ok: false,
      error: "gone",
    });
    expect((await rowOf(made.data.preview.id)).status).toBe("making");
  });

  it("a finished row is superseded, not gone: the file at its key belongs to that run", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    await completePreview(db, { previewId: made.data.preview.id, noGreenScreen: false });
    expect(
      await completePreview(db, { previewId: made.data.preview.id, noGreenScreen: true }),
    ).toEqual({
      ok: false,
      error: "superseded",
    });
    expect((await rowOf(made.data.preview.id)).noGreenScreen).toBe(false);
  });

  it("completing a preview while the take expires never loses the file's deletion", async () => {
    let rejected = 0;
    for (let i = 0; i < 15; i++) {
      const bg = await seedBackground();
      const { creator, take: t } = await readyTake();
      const made = await request(creator.id, t.id, bg.id);
      if (!made.ok) throw new Error(made.error);
      await expire(t.id);
      const settled = await Promise.allSettled([
        completePreview(db, { previewId: made.data.preview.id, noGreenScreen: false }),
        expireTake(db, { takeId: t.id }),
      ]);
      rejected += settled.filter((s) => s.status === "rejected").length;
      // However the two interleave, the preview's key is queued for deletion at expiry, and a
      // completion that lost the race reported gone (so its job deletes the file itself).
      const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
      expect(queued).toContain(previewKey(t.id, made.data.preview.id));
      const done = settled[0];
      if (done?.status === "fulfilled" && !done.value.ok) expect(done.value.error).toBe("gone");
    }
    expect(rejected).toBe(0);
  }, 60_000);
});
describe("take deletion queues the previews' files (AC-10)", () => {
  it("includes every preview key of the take, ready or not", async () => {
    const bg = await seedBackground();
    const other = await seedBackground();
    const { creator, take: t } = await readyTake();
    const a = await request(creator.id, t.id, bg.id);
    const b = await request(creator.id, t.id, other.id);
    if (!a.ok || !b.ok) throw new Error("request failed");
    await completePreview(db, { previewId: a.data.preview.id, noGreenScreen: false });
    const keys = await takeFileKeys(db, [t.id]);
    expect(keys).toContain(previewKey(t.id, a.data.preview.id));
    expect(keys).toContain(previewKey(t.id, b.data.preview.id));

    await db.transaction((tx) => deleteTakesInTx(tx, [t.id]));
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toContain(previewKey(t.id, a.data.preview.id));
    expect(queued).toContain(previewKey(t.id, b.data.preview.id));
    expect(
      await db.select().from(backgroundPreview).where(eq(backgroundPreview.takeId, t.id)),
    ).toHaveLength(0);
  });
});
