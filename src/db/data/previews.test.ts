import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PREVIEW_RUN_MS, PREVIEW_STALE_MS, previewKey } from "@/lib/background-preview";
import { background, backgroundPreview, cut, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { completePreview, failPreview, requestPreview } from "./previews";
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
describe("requestPreview (AC-4)", () => {
  it("makes a new preview and says to dispatch the job", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const result = await request(creator.id, t.id, bg.id);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.dispatch).toBe(true);
    expect(result.data.preview).toMatchObject({
      takeId: t.id,
      backgroundId: bg.id,
      status: "making",
      objectKey: null,
      noGreenScreen: false,
    });
    expect(result.data.preview.cutVersion).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is a cache hit once ready: the same row, no dispatch, the file key kept", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const first = await request(creator.id, t.id, bg.id);
    if (!first.ok) throw new Error(first.error);
    const done = await completePreview(db, {
      previewId: first.data.preview.id,
      noGreenScreen: false,
    });
    expect(done.ok && done.data.objectKey).toBe(previewKey(t.id, first.data.preview.id));
    const again = await request(creator.id, t.id, bg.id);
    if (!again.ok) throw new Error(again.error);
    expect(again.data.dispatch).toBe(false);
    expect(again.data.preview).toMatchObject({ id: first.data.preview.id, status: "ready" });
  });

  it("runs one at a time: a fresh making preview is left alone, and two simultaneous requests make one row", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const results = await Promise.all([
      request(creator.id, t.id, bg.id),
      request(creator.id, t.id, bg.id),
      request(creator.id, t.id, bg.id),
    ]);
    const ok = results.flatMap((r) => (r.ok ? [r.data] : []));
    expect(ok).toHaveLength(3);
    expect(new Set(ok.map((r) => r.preview.id)).size).toBe(1);
    expect(ok.filter((r) => r.dispatch)).toHaveLength(1);
    expect(
      await db.select().from(backgroundPreview).where(eq(backgroundPreview.takeId, t.id)),
    ).toHaveLength(1);
  });

  it("makes a new preview when the cuts change (a new cut version), keeping the old one", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const first = await request(creator.id, t.id, bg.id);
    if (!first.ok) throw new Error(first.error);
    await completePreview(db, { previewId: first.data.preview.id, noGreenScreen: false });
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "pause",
      proposedBy: "rules",
      startMs: 1000,
      endMs: 2500,
      applied: true,
      reason: "Pause",
    });
    const second = await request(creator.id, t.id, bg.id);
    if (!second.ok) throw new Error(second.error);
    expect(second.data.dispatch).toBe(true);
    expect(second.data.preview.id).not.toBe(first.data.preview.id);
    expect(second.data.preview.cutVersion).not.toBe(first.data.preview.cutVersion);
    expect((await rowOf(first.data.preview.id)).status).toBe("ready");
  });

  it("ignores a cut that is not applied", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const first = await request(creator.id, t.id, bg.id);
    if (!first.ok) throw new Error(first.error);
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "pause",
      proposedBy: "rules",
      startMs: 1000,
      endMs: 2500,
      applied: false,
      reason: "Pause",
    });
    const second = await request(creator.id, t.id, bg.id);
    expect(second.ok && second.data.preview.id).toBe(first.data.preview.id);
  });

  it("leaves a making row younger than the derived threshold alone: no reset, no second run", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const first = await request(creator.id, t.id, bg.id);
    if (!first.ok) throw new Error(first.error);
    const startedAt = first.data.preview.updatedAt.getTime();
    // Past the old 2 minute limit, inside a run that is retrying (and the queue margin): the
    // job may still be running, so the ask is answered from the row and nothing is triggered.
    for (const after of [121_000, 5 * 60_000, PREVIEW_RUN_MS, PREVIEW_STALE_MS]) {
      const again = await request(creator.id, t.id, bg.id, new Date(startedAt + after));
      if (!again.ok) throw new Error(again.error);
      expect(again.data.dispatch, `after ${after} ms`).toBe(false);
      expect(again.data.preview.id).toBe(first.data.preview.id);
      // The row is untouched: updatedAt is what the run's idempotency key is made of.
      expect(again.data.preview.updatedAt.getTime()).toBe(startedAt);
    }
    expect((await rowOf(first.data.preview.id)).updatedAt.getTime()).toBe(startedAt);
  });

  it("replaces a making preview older than the threshold, on the same row", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const first = await request(creator.id, t.id, bg.id);
    if (!first.ok) throw new Error(first.error);
    const later = new Date(first.data.preview.updatedAt.getTime() + PREVIEW_STALE_MS + 1_000);
    const stale = await request(creator.id, t.id, bg.id, later);
    if (!stale.ok) throw new Error(stale.error);
    expect(stale.data).toMatchObject({ dispatch: true });
    expect(stale.data.preview.id).toBe(first.data.preview.id);
    expect(stale.data.preview.updatedAt.getTime()).toBe(later.getTime());
  });

  it("starts a failed preview again", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const first = await request(creator.id, t.id, bg.id);
    if (!first.ok) throw new Error(first.error);
    await failPreview(db, first.data.preview.id);
    expect((await rowOf(first.data.preview.id)).status).toBe("failed");
    const again = await request(creator.id, t.id, bg.id);
    if (!again.ok) throw new Error(again.error);
    expect(again.data.dispatch).toBe(true);
    expect(again.data.preview).toMatchObject({ id: first.data.preview.id, status: "making" });
  });

  it("refuses what it must", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const stranger = await createCreator(db);
    expect(await request(stranger.id, t.id, bg.id)).toEqual({ ok: false, error: "not_found" });
    expect(await request(creator.id, "nope", bg.id)).toEqual({ ok: false, error: "not_found" });
    expect(await request(creator.id, t.id, crypto.randomUUID())).toEqual({
      ok: false,
      error: "not_found",
    });
    const theirs = await seedBackground({ creatorId: stranger.id });
    expect(await request(creator.id, t.id, theirs.id)).toEqual({ ok: false, error: "not_found" });
    const pending = await seedBackground({
      status: "processing",
      imageKey: null,
      thumbKey: null,
      width: null,
      height: null,
    });
    expect(await request(creator.id, t.id, pending.id)).toEqual({
      ok: false,
      error: "background_not_ready",
    });
    const processing = await seedTake(db, creator.id, { status: "processing" });
    expect(await request(creator.id, processing.id, bg.id)).toEqual({
      ok: false,
      error: "not_ready",
    });
    const old = await readyTake();
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, old.take.id));
    expect(await request(old.creator.id, old.take.id, bg.id)).toEqual({
      ok: false,
      error: "original_gone",
    });
  });
});
