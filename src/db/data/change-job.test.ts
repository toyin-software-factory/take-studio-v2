import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, cut, processingJob, render, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { finish, markRunning, startChangeJob } from "./jobs";
import { create as createRender } from "./renders";

/** Spec 0011 build step 1: the change job carries a cut plan and a background in one free render. */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

async function seedBackground() {
  const id = crypto.randomUUID();
  await db.insert(background).values({
    id,
    creatorId: null,
    name: "Studio",
    imageKey: `backgrounds/builtin/${id}.jpg`,
    thumbKey: `backgrounds/builtin/${id}.webp`,
    width: 1920,
    height: 1080,
    status: "ready",
  });
  return id;
}

const A = { startMs: 1000, endMs: 2000 };
const B = { startMs: 5000, endMs: 6000 };

/** A Ready take with cuts A and B both applied and a latest render that removed them. */
async function readyTake(opts: { backgroundId?: string | null; keyed?: boolean } = {}) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, {
    status: "ready",
    durationMs: 10_000,
    backgroundId: opts.backgroundId ?? null,
  });
  const [cutA, cutB] = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [id, r] of [
    [cutA, A],
    [cutB, B],
  ] as const) {
    await db.insert(cut).values({ id, takeId: t.id, ...r, kind: "pause", proposedBy: "rules" });
  }
  const jobId = crypto.randomUUID();
  await db.insert(processingJob).values({
    id: jobId,
    takeId: t.id,
    kind: "initial",
    status: "succeeded",
    secondsCharged: 10,
  });
  const renderId = crypto.randomUUID();
  await db.insert(render).values({
    id: renderId,
    takeId: t.id,
    jobId,
    status: "succeeded",
    videoKey: `renders/${t.id}/${renderId}.mp4`,
    durationMs: 8_000,
    removedRanges: [A, B],
    isLatest: true,
    backgroundId: opts.backgroundId ?? null,
    backgroundName: opts.backgroundId ? "Studio" : null,
    keyed: opts.keyed ?? false,
    keyColor: opts.keyed ? "#00b140" : null,
  });
  return { creator, take: t, renderId, cutA, cutB };
}

const start = (
  ctx: { creator: { id: string }; take: { id: string }; renderId: string },
  over: Partial<Parameters<typeof startChangeJob>[1]> = {},
) =>
  startChangeJob(db, {
    creatorId: ctx.creator.id,
    takeId: ctx.take.id,
    baseRenderId: ctx.renderId,
    cuts: [],
    ...over,
  });

const cutRow = async (id: string) => (await db.select().from(cut).where(eq(cut.id, id)))[0]!;

describe("startChangeJob with a cut plan", () => {
  it("restoring a cut and changing the background is one free job; success applies the plan", async () => {
    const bg = await seedBackground();
    const ctx = await readyTake();
    const started = await start(ctx, {
      background: { id: bg },
      cuts: [{ cutId: ctx.cutA, applied: false }],
    });
    if (!started.ok) throw new Error(started.error);
    const [job] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, started.data.id));
    expect(job).toMatchObject({
      kind: "background",
      secondsCharged: 0,
      targetBackgroundId: bg,
      cutPlan: [{ cutId: ctx.cutA, applied: false }],
    });
    // Nothing is applied until the render lands.
    expect((await cutRow(ctx.cutA)).applied).toBe(true);

    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const made = await createRender(db, {
      takeId: ctx.take.id,
      jobId: started.data.id,
      background: { backgroundId: bg, backgroundName: "Studio", keyed: true, keyColor: "#00b140" },
    });
    if (!made.ok) throw new Error(made.error);
    expect(made.data.removedRanges).toEqual([B]);
    await db
      .update(render)
      .set({ status: "succeeded", videoKey: `renders/${ctx.take.id}/${made.data.id}.mp4` })
      .where(eq(render.id, made.data.id));
    const done = await finish(db, { jobId: started.data.id, status: "succeeded" });
    if (!done.ok) throw new Error(done.error);
    expect(done.data.refundedSeconds).toBe(0);

    const a = await cutRow(ctx.cutA);
    expect(a.applied).toBe(false);
    expect(a.creatorChangedAt).not.toBeNull();
    const b = await cutRow(ctx.cutB);
    expect(b).toMatchObject({ applied: true, creatorChangedAt: null });
    const [t] = await db.select().from(take).where(eq(take.id, ctx.take.id));
    expect(t).toMatchObject({ status: "ready", backgroundId: bg });
  });

  it("a failed job applies nothing, and the same request is accepted again (Try again)", async () => {
    const ctx = await readyTake();
    const plan = [{ cutId: ctx.cutA, applied: false }];
    const first = await start(ctx, { cuts: plan });
    if (!first.ok) throw new Error(first.error);
    await markRunning(db, { jobId: first.data.id, triggerRunId: "run" });
    await finish(db, { jobId: first.data.id, status: "failed", failureCode: "ffmpeg_error" });
    expect(await cutRow(ctx.cutA)).toMatchObject({ applied: true, creatorChangedAt: null });
    expect((await start(ctx, { cuts: plan })).ok).toBe(true);
  });

  it("a render that does not match the plan fails the job with render_mismatch and applies nothing", async () => {
    const ctx = await readyTake();
    const started = await start(ctx, { cuts: [{ cutId: ctx.cutA, applied: false }] });
    if (!started.ok) throw new Error(started.error);
    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const made = await createRender(db, { takeId: ctx.take.id, jobId: started.data.id });
    if (!made.ok) throw new Error(made.error);
    await db
      .update(render)
      .set({
        status: "succeeded",
        videoKey: `renders/${ctx.take.id}/${made.data.id}.mp4`,
        removedRanges: [A, B],
      })
      .where(eq(render.id, made.data.id));
    await finish(db, { jobId: started.data.id, status: "succeeded" });
    const [job] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, started.data.id));
    expect(job).toMatchObject({ status: "failed", failureCode: "render_mismatch" });
    expect(await cutRow(ctx.cutA)).toMatchObject({ applied: true, creatorChangedAt: null });
    const [latest] = await db
      .select()
      .from(render)
      .where(and(eq(render.takeId, ctx.take.id), eq(render.isLatest, true)));
    expect(latest?.id).toBe(ctx.renderId);
  });
});

describe("startChangeJob refusals", () => {
  it("refuses a stale baseRenderId", async () => {
    const ctx = await readyTake();
    expect(
      await start(ctx, {
        baseRenderId: crypto.randomUUID(),
        cuts: [{ cutId: ctx.cutA, applied: false }],
      }),
    ).toEqual({ ok: false, error: "stale" });
  });

  it("refuses nothing changed, including after a failed job", async () => {
    const ctx = await readyTake();
    expect(await start(ctx)).toEqual({ ok: false, error: "nothing_changed" });
    // A plan entry equal to the stored state is no change either.
    expect(await start(ctx, { cuts: [{ cutId: ctx.cutA, applied: true }] })).toEqual({
      ok: false,
      error: "nothing_changed",
    });
  });

  it("refuses an unknown cut id and another take's cut", async () => {
    const ctx = await readyTake();
    const other = await readyTake();
    for (const id of [crypto.randomUUID(), other.cutA, "not-a-uuid"]) {
      expect(await start(ctx, { cuts: [{ cutId: id, applied: false }] })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it("refuses another creator's take", async () => {
    const ctx = await readyTake();
    const stranger = await createCreator(db);
    expect(
      await startChangeJob(db, {
        creatorId: stranger.id,
        takeId: ctx.take.id,
        baseRenderId: ctx.renderId,
        cuts: [{ cutId: ctx.cutA, applied: false }],
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a plan that cuts the whole take", async () => {
    const ctx = await readyTake();
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId: ctx.take.id,
      startMs: 0,
      endMs: 10_000,
      kind: "manual",
      proposedBy: "creator",
      applied: false,
    });
    const [whole] = await db.select().from(cut).where(eq(cut.takeId, ctx.take.id));
    const all = await db.select().from(cut).where(eq(cut.takeId, ctx.take.id));
    const target = all.find((c) => c.endMs === 10_000) ?? whole!;
    expect(await start(ctx, { cuts: [{ cutId: target.id, applied: true }] })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("refuses a cut only request when the background the video used is gone (background_missing)", async () => {
    const bg = await seedBackground();
    const ctx = await readyTake({ backgroundId: bg, keyed: true });
    await db.delete(background).where(eq(background.id, bg));
    expect(await start(ctx, { cuts: [{ cutId: ctx.cutA, applied: false }] })).toEqual({
      ok: false,
      error: "background_missing",
    });
  });

  it("refuses while a job is active and when the original is gone", async () => {
    const ctx = await readyTake();
    const plan = [{ cutId: ctx.cutA, applied: false }];
    const first = await start(ctx, { cuts: plan });
    expect(first.ok).toBe(true);
    expect(await start(ctx, { cuts: plan })).toEqual({ ok: false, error: "job_active" });
    const gone = await readyTake();
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(take.id, gone.take.id));
    expect(await start(gone, { cuts: [{ cutId: gone.cutA, applied: false }] })).toEqual({
      ok: false,
      error: "original_gone",
    });
  });

  it("shares the hourly limit between cut and background changes", async () => {
    const bg = await seedBackground();
    const ctx = await readyTake();
    const now = new Date();
    for (let i = 0; i < 10; i += 1) {
      await db.insert(processingJob).values({
        id: crypto.randomUUID(),
        takeId: ctx.take.id,
        kind: "background",
        status: "failed",
        failureCode: "internal_error",
        secondsCharged: 0,
        createdAt: now,
      });
    }
    for (const over of [
      { cuts: [{ cutId: ctx.cutA, applied: false }] },
      { background: { id: bg } },
    ]) {
      expect(await start(ctx, { ...over, now })).toEqual({
        ok: false,
        error: "background_change_limit",
      });
    }
  });
});
