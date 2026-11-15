import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, jobStep, processingJob, render, user } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { finish, markRunning, startChangeJob, whileJobActive } from "./jobs";
import { create as createRender } from "./renders";
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
