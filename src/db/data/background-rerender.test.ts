import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, processingJob, render, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { finish, markRunning, startChangeJob, startTranscribeJob } from "./jobs";
import { built } from "./background-rerender-test-helpers";

/** Spec 0008, build step 3: a background change keeps the take Ready (AC-5, AC-6). */
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
} /** A Ready take whose initial job succeeded with a latest render (keyed on `backgroundId`). */
async function readyTake(opts: { backgroundId?: string | null; keyed?: boolean } = {}) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, {
    status: "ready",
    durationMs: 10_000,
    backgroundId: opts.backgroundId ?? null,
  });
  const jobId = crypto.randomUUID();
  await db.insert(processingJob).values({
    id: jobId,
    takeId: t.id,
    kind: "initial",
    status: "succeeded",
    secondsCharged: 10,
    targetBackgroundId: opts.backgroundId ?? null,
  });
  const renderId = crypto.randomUUID();
  await db.insert(render).values({
    id: renderId,
    takeId: t.id,
    jobId,
    status: "succeeded",
    videoKey: `renders/${t.id}/${renderId}.mp4`,
    durationMs: 9_000,
    removedRanges: [],
    isLatest: true,
    backgroundId: opts.backgroundId ?? null,
    backgroundName: opts.backgroundId ? "Studio" : null,
    keyed: opts.keyed ?? false,
    keyColor: opts.keyed ? "#00b140" : null,
  });
  return { creator, take: t, renderId, initialJobId: jobId };
}
const change = (creatorId: string, takeId: string, backgroundId: string | null) =>
  startChangeJob(db, { creatorId, takeId, background: { id: backgroundId }, cuts: [] });
const takeRow = async (id: string) => (await db.select().from(take).where(eq(take.id, id)))[0]!;
describe("startChangeJob", () => {
  it("starts a free re render that keeps the take Ready and records the target (AC-5)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const started = await change(creator.id, t.id, bg.id);
    if (!started.ok) throw new Error(started.error);
    expect(started.data).toMatchObject({
      kind: "background",
      status: "queued",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
      targetBackgroundId: bg.id,
    });
    expect(started.data.steps.map((s) => s.name)).toEqual(["background", "render"]);
    expect((await takeRow(t.id)).status).toBe("ready");
  });

  it("has only the render step when the target is the original", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake({ backgroundId: bg.id, keyed: true });
    const started = await change(creator.id, t.id, null);
    if (!started.ok) throw new Error(started.error);
    expect(started.data.targetBackgroundId).toBeNull();
    expect(started.data.steps.map((s) => s.name)).toEqual(["render"]);
  });

  it("refuses a background that doesn't exist, or belongs to another creator, as not_found", async () => {
    const { creator, take: t } = await readyTake();
    expect(await change(creator.id, t.id, crypto.randomUUID())).toEqual({
      ok: false,
      error: "not_found",
    });
    const other = await createCreator(db);
    const theirs = await seedBackground({ creatorId: other.id, name: "Mine" });
    expect(await change(creator.id, t.id, theirs.id)).toEqual({ ok: false, error: "not_found" });
    // The owner may use their own.
    const own = await seedBackground({ creatorId: creator.id, name: "Own" });
    expect((await change(creator.id, t.id, own.id)).ok).toBe(true);
  });

  it.each(["uploading", "processing", "failed"] as const)(
    "refuses a background that is %s (background_not_ready)",
    async (status) => {
      const bg = await seedBackground({
        status,
        imageKey: null,
        thumbKey: null,
        width: null,
        height: null,
      });
      const { creator, take: t } = await readyTake();
      expect(await change(creator.id, t.id, bg.id)).toEqual({
        ok: false,
        error: "background_not_ready",
      });
    },
  );

  it("refuses another creator's take (not_found) and a take that is not Ready", async () => {
    const bg = await seedBackground();
    const { take: t } = await readyTake();
    const stranger = await createCreator(db);
    expect(await change(stranger.id, t.id, bg.id)).toEqual({ ok: false, error: "not_found" });
    const creator = await createCreator(db);
    const processing = await seedTake(db, creator.id, { status: "processing" });
    expect(await change(creator.id, processing.id, bg.id)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("refuses when the original has expired, before or after the sweep (original_gone)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(take.id, t.id));
    expect(await change(creator.id, t.id, bg.id)).toEqual({ ok: false, error: "original_gone" });
    await db.update(take).set({ status: "expired" }).where(eq(take.id, t.id));
    expect(await change(creator.id, t.id, bg.id)).toEqual({ ok: false, error: "original_gone" });
  });

  it("refuses while any job runs, a transcript included (job_active)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const transcribing = await startTranscribeJob(db, { takeId: t.id });
    expect(transcribing.ok).toBe(true);
    expect(await change(creator.id, t.id, bg.id)).toEqual({ ok: false, error: "job_active" });
    const second = await readyTake();
    expect((await change(second.creator.id, second.take.id, bg.id)).ok).toBe(true);
    expect(await change(second.creator.id, second.take.id, bg.id)).toEqual({
      ok: false,
      error: "job_active",
    });
  });

  it("refuses the background the video already has (nothing_changed), original included", async () => {
    const bg = await seedBackground();
    const keyed = await readyTake({ backgroundId: bg.id, keyed: true });
    expect(await change(keyed.creator.id, keyed.take.id, bg.id)).toEqual({
      ok: false,
      error: "nothing_changed",
    });
    const plain = await readyTake();
    expect(await change(plain.creator.id, plain.take.id, null)).toEqual({
      ok: false,
      error: "nothing_changed",
    });
  });

  it("refuses a real background when the last render found no green screen; the original is not refused for it (no_green_screen)", async () => {
    const bg = await seedBackground();
    const other = await seedBackground();
    const unkeyed = await readyTake({ backgroundId: bg.id, keyed: false });
    for (const target of [bg.id, other.id]) {
      expect(await change(unkeyed.creator.id, unkeyed.take.id, target)).toEqual({
        ok: false,
        error: "no_green_screen",
      });
    }
    // Back to the original is not a no_green_screen refusal: the video is on it already.
    expect(await change(unkeyed.creator.id, unkeyed.take.id, null)).toEqual({
      ok: false,
      error: "nothing_changed",
    });
    // A take with no render snapshot name at all (never keyed on a chosen background) is free.
    const plain = await readyTake();
    expect((await change(plain.creator.id, plain.take.id, bg.id)).ok).toBe(true);
  });

  it("lets a take keyed on a deleted background go back to the original or pick another", async () => {
    const gone = await seedBackground();
    const keyed = await readyTake({ backgroundId: gone.id, keyed: true });
    await db.delete(background).where(eq(background.id, gone.id));
    // The render is still keyed (its name kept) but its reference is null: not the original.
    expect((await change(keyed.creator.id, keyed.take.id, null)).ok).toBe(true);
    const other = await readyTake({ backgroundId: (await seedBackground()).id, keyed: true });
    const dead = await seedBackground();
    await db.update(render).set({ backgroundId: null }).where(eq(render.takeId, other.take.id));
    expect((await change(other.creator.id, other.take.id, dead.id)).ok).toBe(true);
  });

  it("allows the same background again after a failed change (Try again)", async () => {
    const bg = await seedBackground();
    const other = await seedBackground();
    const { creator, take: t } = await readyTake({ backgroundId: bg.id, keyed: true });
    const first = await change(creator.id, t.id, other.id);
    if (!first.ok) throw new Error(first.error);
    await markRunning(db, { jobId: first.data.id, triggerRunId: "run" });
    await finish(db, { jobId: first.data.id, status: "failed", failureCode: "ffmpeg_error" });
    // The video is still on `bg`; asking for `other` again is the retry.
    expect((await change(creator.id, t.id, other.id)).ok).toBe(true);
  });
});
