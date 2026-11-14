import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PREVIEW_RUN_MS, PREVIEW_STALE_MS, previewKey } from "@/lib/background-preview";
import { background, backgroundPreview, cut, render, storageDeletion, take } from "../schema";
import {
  type TestDb,
  createCreator,
  openTestDb,
  seedTake,
  builtInTracker,
} from "../testing/test-db";
import type { Db } from "../types";
import { deleteTakesInTx, expireTake, takeFileKeys } from "./deletion";
import {
  completePreview,
  failPreview,
  getPreview,
  loadPreviewWork,
  requestPreview,
} from "./previews";

/** Spec 0008, build step 4: the preview cache (AC-4). */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
const built = builtInTracker();
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

describe("getPreview", () => {
  it("reads the current version's row, and not_found when none was asked for or it is not theirs", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    expect(
      await getPreview(db, { creatorId: creator.id, takeId: t.id, backgroundId: bg.id }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    const got = await getPreview(db, { creatorId: creator.id, takeId: t.id, backgroundId: bg.id });
    expect(got.ok && got.data.id).toBe(made.data.preview.id);
    const stranger = await createCreator(db);
    expect(
      await getPreview(db, { creatorId: stranger.id, takeId: t.id, backgroundId: bg.id }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("the job's view: loadPreviewWork and completePreview", () => {
  it("loads the rows and the latest render, only while the preview is making", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    const work = await loadPreviewWork(db, made.data.preview.id);
    expect(work?.preview.id).toBe(made.data.preview.id);
    expect(work?.latestRender).toBeNull();
    await completePreview(db, { previewId: made.data.preview.id, noGreenScreen: true });
    expect(await loadPreviewWork(db, made.data.preview.id)).toBeNull();
    expect(await loadPreviewWork(db, crypto.randomUUID())).toBeNull();
  });

  it("returns the latest render so a keyed take's colour is reused", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const jobId = crypto.randomUUID();
    const { processingJob } = await import("../schema");
    await db
      .insert(processingJob)
      .values({ id: jobId, takeId: t.id, kind: "initial", status: "succeeded", secondsCharged: 5 });
    await db.insert(render).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      jobId,
      status: "succeeded",
      videoKey: "k",
      durationMs: 9000,
      removedRanges: [],
      isLatest: true,
      backgroundId: bg.id,
      backgroundName: "Studio",
      keyed: true,
      keyColor: "#00b140",
    });
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    expect((await loadPreviewWork(db, made.data.preview.id))?.latestRender).toMatchObject({
      keyed: true,
      keyColor: "#00b140",
    });
  });

  it("stores the no green screen flag", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const made = await request(creator.id, t.id, bg.id);
    if (!made.ok) throw new Error(made.error);
    const done = await completePreview(db, {
      previewId: made.data.preview.id,
      noGreenScreen: true,
    });
    expect(done.ok && done.data).toMatchObject({ status: "ready", noGreenScreen: true });
  });

  it("writes nothing for a deleted take, a deleted background or a row that was reset", async () => {
    const bg = await seedBackground();
    const a = await readyTake();
    const madeA = await request(a.creator.id, a.take.id, bg.id);
    if (!madeA.ok) throw new Error(madeA.error);
    await db.delete(take).where(eq(take.id, a.take.id));
    expect(await loadPreviewWork(db, madeA.data.preview.id)).toBeNull();
    expect(
      await completePreview(db, { previewId: madeA.data.preview.id, noGreenScreen: false }),
    ).toEqual({
      ok: false,
      error: "gone",
    });

    const bg2 = await seedBackground();
    const b = await readyTake();
    const madeB = await request(b.creator.id, b.take.id, bg2.id);
    if (!madeB.ok) throw new Error(madeB.error);
    await db.delete(background).where(eq(background.id, bg2.id));
    expect(
      await completePreview(db, { previewId: madeB.data.preview.id, noGreenScreen: false }),
    ).toEqual({
      ok: false,
      error: "gone",
    });

    const bg3 = await seedBackground();
    const c = await readyTake();
    const madeC = await request(c.creator.id, c.take.id, bg3.id);
    if (!madeC.ok) throw new Error(madeC.error);
    await failPreview(db, madeC.data.preview.id);
    expect(
      (await completePreview(db, { previewId: madeC.data.preview.id, noGreenScreen: false })).ok,
    ).toBe(false);
  });
});

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
