import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, render, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import {
  completePreview,
  failPreview,
  getPreview,
  loadPreviewWork,
  requestPreview,
} from "./previews";
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
