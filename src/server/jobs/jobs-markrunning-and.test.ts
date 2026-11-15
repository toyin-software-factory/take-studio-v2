import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingJob, render, storageDeletion, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { finish, markRunning, start, updateStep } from ".";
import { NOW, SECRET } from "./jobs-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_jobs_markrunning_and" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
async function startOk(creatorId: string, takeId: string) {
  const result = await start(db, { creatorId, takeId, usageSecret: SECRET, now: NOW });
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.data;
} /** Inserts a render for a job the way the render step will (FDM-T03 owns its functions). */
async function seedRender(
  takeId: string,
  jobId: string,
  values: Partial<typeof render.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await db.insert(render).values({
    id,
    takeId,
    jobId,
    status: "succeeded",
    videoKey: `renders/${takeId}/${id}.mp4`,
    removedRanges: [],
    ...values,
  });
  return id;
}
async function takeRow(id: string) {
  const [row] = await db.select().from(take).where(eq(take.id, id));
  return row;
}
describe("jobs.markRunning and jobs.updateStep (AC-7)", () => {
  it("marks a queued job running once, and refuses a final job", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);

    const running = await markRunning(db, { jobId: job.id, triggerRunId: "run_abc", now: NOW });
    expect(running.ok && running.data).toMatchObject({
      status: "running",
      triggerRunId: "run_abc",
      startedAt: NOW,
    });
    expect((await markRunning(db, { jobId: job.id, triggerRunId: "run_abc" })).ok).toBe(true);

    await finish(db, { jobId: job.id, status: "failed", failureCode: "timeout" });
    expect(await markRunning(db, { jobId: job.id, triggerRunId: "run_abc" })).toEqual({
      ok: false,
      error: "already_final",
    });
  });

  it("records step status and progress, and rejects bad updates", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);

    const step = await updateStep(db, {
      jobId: job.id,
      name: "trim",
      status: "running",
      progress: 40,
      now: NOW,
    });
    expect(step.ok && step.data).toMatchObject({ status: "running", progress: 40, startedAt: NOW });
    const done = await updateStep(db, {
      jobId: job.id,
      name: "trim",
      status: "succeeded",
      progress: 100,
    });
    expect(done.ok && done.data).toMatchObject({
      status: "succeeded",
      progress: 100,
      startedAt: NOW,
    });
    expect(done.ok && done.data.finishedAt).toBeInstanceOf(Date);

    const invalid = { ok: false, error: "invalid" };
    expect(
      await updateStep(db, { jobId: job.id, name: "trim", status: "running", progress: 101 }),
    ).toEqual(invalid);
    // A step this job doesn't have (an initial job without a background has no background step).
    expect(
      await updateStep(db, { jobId: job.id, name: "background", status: "running", progress: 1 }),
    ).toEqual(invalid);

    await finish(db, { jobId: job.id, status: "failed", failureCode: "timeout" });
    expect(
      await updateStep(db, { jobId: job.id, name: "render", status: "running", progress: 1 }),
    ).toEqual(invalid);
  });
});
describe("jobs.finish (AC-10, AC-11, AC-12, AC-13)", () => {
  it("on success makes the take ready and its render the latest, queuing the old file", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const first = await startOk(creator.id, t.id);
    const firstRender = await seedRender(t.id, first.id);
    expect((await finish(db, { jobId: first.id, status: "succeeded" })).ok).toBe(true);

    const second = await startOk(creator.id, t.id);
    const secondRender = await seedRender(t.id, second.id);
    const done = await finish(db, { jobId: second.id, status: "succeeded" });

    expect(done.ok && done.data.take.status).toBe("ready");
    const oldKey = `renders/${t.id}/${firstRender}.mp4`;
    expect(done.ok && done.data.queuedKeys).toEqual([oldKey]);
    const renders = await db.select().from(render).where(eq(render.takeId, t.id));
    expect(renders.find((r) => r.id === firstRender)).toMatchObject({
      isLatest: false,
      videoKey: null,
    });
    expect(renders.find((r) => r.id === secondRender)).toMatchObject({ isLatest: true });
    const queued = await db
      .select()
      .from(storageDeletion)
      .where(eq(storageDeletion.objectKey, oldKey));
    expect(queued).toHaveLength(1);
  });

  it("returns the take to ready when a re render fails, and refunds nothing (charge was 0)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const first = await startOk(creator.id, t.id);
    await seedRender(t.id, first.id);
    await finish(db, { jobId: first.id, status: "succeeded" });

    const rerender = await startOk(creator.id, t.id);
    const failed = await finish(db, {
      jobId: rerender.id,
      status: "failed",
      failureCode: "ffmpeg_error",
    });
    expect(failed.ok && failed.data).toMatchObject({
      take: { status: "ready" },
      job: { status: "failed", failureCode: "ffmpeg_error", refunded: false },
      refundedSeconds: 0,
    });
  });

  it("fails a take with no render and refunds once, even when finished twice", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);

    const first = await finish(db, { jobId: job.id, status: "failed", failureCode: "stale_run" });
    expect(first.ok && first.data).toMatchObject({
      take: { status: "failed", failureCode: "stale_run" },
      job: { refunded: true },
      refundedSeconds: 62,
    });
    expect(await finish(db, { jobId: job.id, status: "failed", failureCode: "stale_run" })).toEqual(
      {
        ok: false,
        error: "already_final",
      },
    );
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(row).toMatchObject({ refunded: true, secondsCharged: 62 });
  });

  it("does not refund a non refundable failure", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);
    const result = await finish(db, {
      jobId: job.id,
      status: "failed",
      failureCode: "invalid_media",
    });
    expect(result.ok && result.data).toMatchObject({
      refundedSeconds: 0,
      job: { refunded: false },
    });
  });

  it("rejects a mismatched status and code, and rolls back fully when the take can't move", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);
    const invalid = { ok: false, error: "invalid" };
    expect(await finish(db, { jobId: job.id, status: "failed" })).toEqual(invalid);
    expect(
      await finish(db, { jobId: job.id, status: "succeeded", failureCode: "timeout" }),
    ).toEqual(invalid);

    // Force the take out of `processing`: finishing must not half apply.
    await db.update(take).set({ status: "ready" }).where(eq(take.id, t.id));
    expect(await finish(db, { jobId: job.id, status: "failed", failureCode: "timeout" })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(row).toMatchObject({ status: "queued", refunded: false, failureCode: null });
  });
});
describe("take failure code after a retry", () => {
  it("clears the old failure code when the retry starts and when it succeeds", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const first = await startOk(creator.id, t.id);
    await finish(db, { jobId: first.id, status: "failed", failureCode: "stale_run" });
    expect((await takeRow(t.id))?.failureCode).toBe("stale_run");

    const retry = await startOk(creator.id, t.id);
    expect((await takeRow(t.id))?.failureCode).toBeNull();
    await seedRender(t.id, retry.id);
    const done = await finish(db, { jobId: retry.id, status: "succeeded" });
    expect(done.ok && done.data.take).toMatchObject({ status: "ready", failureCode: null });
  });
});
