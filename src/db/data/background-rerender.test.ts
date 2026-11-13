import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, jobStep, processingJob, render, storageDeletion, take, user } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import {
  finish,
  markRunning,
  startChangeJob,
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

  it("LEGACY: a `rerender` an old Worker started on a Ready take finishes as a background change", async () => {
    const newBg = await seedBackground();
    const ctx = await running(newBg.id, { backgroundId: null, keyed: false });
    // What an old Worker would have written: the same job, but of kind `rerender`.
    await db.update(processingJob).set({ kind: "rerender" }).where(eq(processingJob.id, ctx.jobId));
    const done = await finish(db, { jobId: ctx.jobId, status: "succeeded" });
    if (!done.ok) throw new Error(done.error);
    expect(done.data.refundedSeconds).toBe(0);
    const t = await takeRow(ctx.take.id);
    expect(t).toMatchObject({ status: "ready", backgroundId: newBg.id });
    const renders = await db.select().from(render).where(eq(render.takeId, ctx.take.id));
    expect(renders.find((r) => r.isLatest)?.id).toBe(ctx.newRenderId);
  });

  it("sets the take's background from the new render, so a delete mid job cannot leave a dangling target", async () => {
    const oldBg = await seedBackground();
    const newBg = await seedBackground();
    const ctx = await running(newBg.id, { backgroundId: oldBg.id, keyed: true });
    // The studio is deleted after the render was made: the references clear, the name stays.
    await db.delete(background).where(eq(background.id, newBg.id));
    const done = await finish(db, { jobId: ctx.jobId, status: "succeeded" });
    if (!done.ok) throw new Error(done.error);
    const t = await takeRow(ctx.take.id);
    expect(t).toMatchObject({ status: "ready", backgroundId: null });
    const made = (await db.select().from(render).where(eq(render.id, ctx.newRenderId)))[0];
    expect(made).toMatchObject({
      isLatest: true,
      backgroundId: null,
      backgroundName: "New",
      keyed: true,
    });
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
  /**
   * Runs the pair `ROUNDS` times and counts every operation that rejected, a deadlock (40P01) or
   * any other error: a pair that fails for another reason must not pass as "no deadlock".
   */
  const deadlocks = async (run: () => Promise<PromiseSettledResult<unknown>[]>) => {
    let found = 0;
    for (let i = 0; i < ROUNDS; i++) {
      for (const s of await run()) {
        if (s.status === "rejected") found += 1;
      }
    }
    return found;
  };

  it("deleting a background while startChangeJob picks it never deadlocks", async () => {
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

  it("finishing a change and deleting its target never deadlock", async () => {
    let found = 0;
    for (let i = 0; i < 20; i++) {
      const oldBg = await seedBackground();
      const newBg = await seedBackground();
      const ctx = await readyTake({ backgroundId: oldBg.id, keyed: true });
      const started = await change(ctx.creator.id, ctx.take.id, newBg.id);
      if (!started.ok) throw new Error(started.error);
      await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
      const made = await createRender(db, {
        takeId: ctx.take.id,
        jobId: started.data.id,
        background: {
          backgroundId: newBg.id,
          backgroundName: "New",
          keyed: true,
          keyColor: "#00b140",
        },
      });
      if (!made.ok) throw new Error(made.error);
      await db
        .update(render)
        .set({
          status: "succeeded",
          videoKey: `renders/${ctx.take.id}/${made.data.id}.mp4`,
          durationMs: 9_000,
        })
        .where(eq(render.id, made.data.id));
      const settled = await Promise.allSettled([
        finish(db, { jobId: started.data.id, status: "succeeded" }),
        db.delete(background).where(eq(background.id, newBg.id)),
      ]);
      // Both must succeed: a rejection of any kind fails the test, not only a deadlock.
      for (const s of settled) {
        if (s.status === "rejected") found += 1;
      }
    }
    expect(found).toBe(0);
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

/**
 * A finished job started `startedAt`, on the take: a background change (kind `background`), or a
 * LEGACY `rerender` (what background changes were before the kind existed; a `rerender` never has
 * a `trim` step).
 */
async function seedChange(
  takeId: string,
  startedAt: Date,
  kind: "background" | "rerender" = "background",
) {
  await db.insert(processingJob).values({
    id: crypto.randomUUID(),
    takeId,
    kind,
    status: "failed",
    failureCode: "internal_error",
    secondsCharged: 0,
    createdAt: startedAt,
  });
}

describe("background change limit (HRF-T01)", () => {
  it("allows 10 changes in an hour and refuses the 11th, then allows one after the window", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    for (let i = 0; i < 10; i += 1) await seedChange(t.id, new Date(now.getTime() - i * 60_000));
    const refused = await startChangeJob(db, {
      creatorId: creator.id,
      takeId: t.id,
      background: { id: bg.id },
      cuts: [],
      now,
    });
    expect(refused).toEqual({ ok: false, error: "background_change_limit" });
    // Nothing was started by the refusal.
    expect(
      (await db.select().from(processingJob).where(eq(processingJob.takeId, t.id))).filter(
        (j) => j.status === "queued",
      ),
    ).toHaveLength(0);
    // Once the oldest of the ten (made at `now`) is more than an hour old, the window has room.
    const later = new Date(now.getTime() + 3_600_000 + 1_000);
    const again = await startChangeJob(db, {
      creatorId: creator.id,
      takeId: t.id,
      background: { id: bg.id },
      cuts: [],
      now: later,
    });
    expect(again.ok).toBe(true);
  });

  it("counts the nine below the limit as allowed, whatever way the change went (failed ones included)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    for (let i = 0; i < 9; i += 1) await seedChange(t.id, now);
    expect(
      (
        await startChangeJob(db, {
          creatorId: creator.id,
          takeId: t.id,
          background: { id: bg.id },
          cuts: [],
          now,
        })
      ).ok,
    ).toBe(true);
  });

  it("counts the creator's changes across all their takes, not one take's", async () => {
    const bg = await seedBackground();
    const { creator, take: first } = await readyTake();
    const second = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
    const now = new Date();
    for (let i = 0; i < 6; i += 1) await seedChange(first.id, now);
    for (let i = 0; i < 4; i += 1) await seedChange(second.id, now);
    expect(
      await startChangeJob(db, {
        creatorId: creator.id,
        takeId: first.id,
        background: { id: bg.id },
        cuts: [],
        now,
      }),
    ).toEqual({ ok: false, error: "background_change_limit" });
  });

  it("one creator never blocks another, and other kinds do not count", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    // The same take's initial and transcribe jobs are not background changes.
    for (let i = 0; i < 10; i += 1) {
      await db.insert(processingJob).values({
        id: crypto.randomUUID(),
        takeId: t.id,
        kind: i % 2 === 0 ? "initial" : "transcribe",
        status: "succeeded",
        secondsCharged: 0,
        createdAt: now,
      });
    }
    expect(
      (
        await startChangeJob(db, {
          creatorId: creator.id,
          takeId: t.id,
          background: { id: bg.id },
          cuts: [],
          now,
        })
      ).ok,
    ).toBe(true);

    const busy = await readyTake();
    for (let i = 0; i < 10; i += 1) await seedChange(busy.take.id, now);
    const calm = await readyTake();
    expect(
      await startChangeJob(db, {
        creatorId: busy.creator.id,
        takeId: busy.take.id,
        background: { id: bg.id },
        cuts: [],
        now,
      }),
    ).toEqual({ ok: false, error: "background_change_limit" });
    expect(
      (
        await startChangeJob(db, {
          creatorId: calm.creator.id,
          takeId: calm.take.id,
          background: { id: bg.id },
          cuts: [],
          now,
        })
      ).ok,
    ).toBe(true);
  });

  it("LEGACY: a `rerender` (what background changes were before the kind) still counts toward the limit", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    for (let i = 0; i < 10; i += 1) await seedChange(t.id, now, "rerender");
    expect(
      await startChangeJob(db, {
        creatorId: creator.id,
        takeId: t.id,
        background: { id: bg.id },
        cuts: [],
        now,
      }),
    ).toEqual({ ok: false, error: "background_change_limit" });
  });

  it("parallel requests cannot both pass the last free slot (the creator's row is locked)", async () => {
    const bg = await seedBackground();
    const { creator } = await readyTake();
    const takes = await Promise.all(
      [0, 1].map(() => seedTake(db, creator.id, { status: "ready", durationMs: 10_000 })),
    );
    const now = new Date();
    const filler = takes[0]!;
    for (let i = 0; i < 9; i += 1) await seedChange(filler.id, now);
    const results = await Promise.all(
      takes.map((t) =>
        startChangeJob(db, {
          creatorId: creator.id,
          takeId: t.id,
          background: { id: bg.id },
          cuts: [],
          now,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "background_change_limit")).toHaveLength(1);
  });
});
