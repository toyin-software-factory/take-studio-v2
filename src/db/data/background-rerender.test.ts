import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, jobStep, processingJob, render, storageDeletion, take, user } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { pgErrorCode } from "../types";
import {
  finish,
  markRunning,
  startBackgroundJob,
  startJob,
  startTranscribeJob,
  whileJobActive,
} from "./jobs";
import { create as createRender } from "./renders";

/** Spec 0008, build step 3: a background change keeps the take Ready (AC-5, AC-6). */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

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
  return row!;
}

/** A Ready take whose initial job succeeded with a latest render (keyed on `backgroundId`). */
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
  startBackgroundJob(db, { creatorId, takeId, backgroundId });

const takeRow = async (id: string) => (await db.select().from(take).where(eq(take.id, id)))[0]!;

describe("startBackgroundJob", () => {
  it("starts a free re render that keeps the take Ready and records the target (AC-5)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const started = await change(creator.id, t.id, bg.id);
    if (!started.ok) throw new Error(started.error);
    expect(started.data).toMatchObject({
      kind: "rerender",
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

  it("refuses the background the video already has (same_background), original included", async () => {
    const bg = await seedBackground();
    const keyed = await readyTake({ backgroundId: bg.id, keyed: true });
    expect(await change(keyed.creator.id, keyed.take.id, bg.id)).toEqual({
      ok: false,
      error: "same_background",
    });
    const plain = await readyTake();
    expect(await change(plain.creator.id, plain.take.id, null)).toEqual({
      ok: false,
      error: "same_background",
    });
  });

  it("lets a no green screen take pick its background again: the video is not on it", async () => {
    const bg = await seedBackground();
    const unkeyed = await readyTake({ backgroundId: bg.id, keyed: false });
    expect((await change(unkeyed.creator.id, unkeyed.take.id, bg.id)).ok).toBe(true);
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

describe("finishing a background change (AC-5)", () => {
  async function running(
    target: string | null,
    from: { backgroundId: string | null; keyed: boolean },
  ) {
    const ctx = await readyTake(from);
    const started = await change(ctx.creator.id, ctx.take.id, target);
    if (!started.ok) throw new Error(started.error);
    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const made = await createRender(db, {
      takeId: ctx.take.id,
      jobId: started.data.id,
      background: target
        ? { backgroundId: target, backgroundName: "New", keyed: true, keyColor: "#00b140" }
        : undefined,
    });
    if (!made.ok) throw new Error(made.error);
    const newKey = `renders/${ctx.take.id}/${made.data.id}.mp4`;
    await db
      .update(render)
      .set({ status: "succeeded", videoKey: newKey, durationMs: 9_000 })
      .where(eq(render.id, made.data.id));
    return { ...ctx, jobId: started.data.id, newRenderId: made.data.id, newKey };
  }

  const queued = async () => (await db.select().from(storageDeletion)).map((r) => r.objectKey);

  it("on success the new render and background become current, the take stays Ready, nothing is refunded", async () => {
    const oldBg = await seedBackground();
    const newBg = await seedBackground();
    const ctx = await running(newBg.id, { backgroundId: oldBg.id, keyed: true });
    const done = await finish(db, { jobId: ctx.jobId, status: "succeeded" });
    if (!done.ok) throw new Error(done.error);
    expect(done.data.refundedSeconds).toBe(0);
    expect(done.data.take.status).toBe("ready");
    const t = await takeRow(ctx.take.id);
    expect(t).toMatchObject({ status: "ready", backgroundId: newBg.id, failureCode: null });
    const renders = await db.select().from(render).where(eq(render.takeId, ctx.take.id));
    expect(renders.find((r) => r.isLatest)?.id).toBe(ctx.newRenderId);
    // The old video's file is queued for deletion; the new one is kept.
    const keys = await queued();
    expect(keys).toContain(`renders/${ctx.take.id}/${ctx.renderId}.mp4`);
    expect(keys).not.toContain(ctx.newKey);
  });

  it("a change back to the original clears the take's background", async () => {
    const oldBg = await seedBackground();
    const ctx = await running(null, { backgroundId: oldBg.id, keyed: true });
    await finish(db, { jobId: ctx.jobId, status: "succeeded" });
    expect((await takeRow(ctx.take.id)).backgroundId).toBeNull();
  });

  it.each([
    ["failed", "ffmpeg_error"],
    ["cancelled", "cancelled_while_running"],
  ] as const)(
    "on a %s job the take, its latest render and its background stay; only the new file goes",
    async (status, failureCode) => {
      const oldBg = await seedBackground();
      const newBg = await seedBackground();
      const ctx = await running(newBg.id, { backgroundId: oldBg.id, keyed: true });
      const done = await finish(db, { jobId: ctx.jobId, status, failureCode });
      if (!done.ok) throw new Error(done.error);
      const t = await takeRow(ctx.take.id);
      expect(t).toMatchObject({ status: "ready", backgroundId: oldBg.id });
      const renders = await db.select().from(render).where(eq(render.takeId, ctx.take.id));
      expect(renders.find((r) => r.isLatest)?.id).toBe(ctx.renderId);
      const keys = await queued();
      expect(keys).toContain(`renders/${ctx.take.id}/${ctx.newRenderId}.mp4`);
      expect(keys).not.toContain(`renders/${ctx.take.id}/${ctx.renderId}.mp4`);
      const [job] = await db.select().from(processingJob).where(eq(processingJob.id, ctx.jobId));
      expect(job).toMatchObject({ status, failureCode, secondsCharged: 0, refunded: false });
    },
  );

  it("charged nothing: the take's usage is unchanged by the change", async () => {
    const newBg = await seedBackground();
    const ctx = await running(newBg.id, { backgroundId: null, keyed: false });
    await finish(db, { jobId: ctx.jobId, status: "succeeded" });
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, ctx.take.id));
    const charged = jobs.filter((j) => !j.refunded).reduce((n, j) => n + j.secondsCharged, 0);
    expect(charged).toBe(10); // the initial job's, only
  });

  it("a re render started by startJob (take processing) still moves the take as before", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "failed", durationMs: 8_000 });
    await db.insert(processingJob).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "initial",
      status: "succeeded",
      secondsCharged: 8,
    });
    const started = await startJob(db, {
      creatorId: creator.id,
      takeId: t.id,
      usageSecret: "x".repeat(40),
    });
    if (!started.ok) throw new Error(started.error);
    expect(started.data.kind).toBe("rerender");
    expect((await takeRow(t.id)).status).toBe("processing");
    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const done = await finish(db, {
      jobId: started.data.id,
      status: "failed",
      failureCode: "ffmpeg_error",
    });
    expect(done.ok && done.data.take.status).toBe("failed");
  });
});

describe("lock order with a background (spec 0008)", () => {
  const ROUNDS = 20;
  const deadlocks = async (run: () => Promise<PromiseSettledResult<unknown>[]>) => {
    let found = 0;
    for (let i = 0; i < ROUNDS; i++) {
      for (const s of await run()) {
        if (s.status === "rejected" && pgErrorCode(s.reason).code === "40P01") found += 1;
      }
    }
    return found;
  };

  it("deleting a background while startBackgroundJob picks it never deadlocks", async () => {
    const count = await deadlocks(async () => {
      const bg = await seedBackground();
      const { creator, take: t } = await readyTake();
      return Promise.allSettled([
        db.delete(background).where(eq(background.id, bg.id)),
        change(creator.id, t.id, bg.id),
      ]);
    });
    expect(count).toBe(0);
  }, 60_000);

  it("deleting a background while a render is created for a job on it never deadlocks", async () => {
    const count = await deadlocks(async () => {
      const bg = await seedBackground();
      const { creator, take: t } = await readyTake();
      const other = await seedBackground();
      const started = await change(creator.id, t.id, other.id);
      if (!started.ok) throw new Error(started.error);
      await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
      return Promise.allSettled([
        db.delete(background).where(eq(background.id, other.id)),
        whileJobActive(db, started.data.id, (tx) =>
          createRender(tx, {
            takeId: t.id,
            jobId: started.data.id,
            background: {
              backgroundId: other.id,
              backgroundName: "x",
              keyed: true,
              keyColor: "#00b140",
            },
          }),
        ),
        db.delete(background).where(eq(background.id, bg.id)),
      ]);
    });
    expect(count).toBe(0);
  }, 60_000);

  it("a background delete leaves a running change's job without a target but intact", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const started = await change(creator.id, t.id, bg.id);
    if (!started.ok) throw new Error(started.error);
    await db.delete(background).where(eq(background.id, bg.id));
    const [job] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, started.data.id));
    expect(job).toMatchObject({ status: "queued", targetBackgroundId: null });
    const steps = await db.select().from(jobStep).where(eq(jobStep.jobId, started.data.id));
    expect(steps).toHaveLength(2);
    expect(await db.select().from(user).where(eq(user.id, creator.id))).toHaveLength(1);
  });
});
