import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingJob, render, storageDeletion, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { cancel, finish, markRunning, start, updateStep } from ".";

// Test value only; the real secret is USAGE_HASH_SECRET.
const SECRET = "test-usage-hash-secret-0123456789abcdef";
const NOW = new Date("2026-11-11T09:30:00Z");

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb.close());

async function startOk(creatorId: string, takeId: string) {
  const result = await start(db, { creatorId, takeId, usageSecret: SECRET, now: NOW });
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.data;
}

/** Inserts a render for a job the way the render step will (FDM-T03 owns its functions). */
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

describe("jobs.start (AC-6, AC-7)", () => {
  it("starts an initial job: charges the length, records month and account hash, creates live steps", async () => {
    const creator = await createCreator(db, `Ada.Love+yt.${crypto.randomUUID()}@GoogleMail.com`);
    const t = await seedTake(db, creator.id, { durationMs: 61_500 });

    const job = await startOk(creator.id, t.id);

    const canonical = creator.email
      .toLowerCase()
      .replace(/\+.*@/, "@")
      .replace("googlemail", "gmail");
    const [local, domain] = canonical.split("@");
    const expectedHash = createHmac("sha256", SECRET)
      .update(`${local?.replaceAll(".", "")}@${domain}`)
      .digest("hex");
    expect(job).toMatchObject({
      kind: "initial",
      status: "queued",
      secondsCharged: 62,
      chargedMonth: "2026-11-01",
      chargedAccountHash: expectedHash,
      refunded: false,
    });
    expect(job.steps.map((s) => [s.name, s.position, s.status, s.progress])).toEqual([
      ["trim", 0, "pending", 0],
      ["render", 1, "pending", 0],
    ]);
    expect((await takeRow(t.id))?.status).toBe("processing");
  });

  it("gives job_in_progress to the loser of two simultaneous starts, with one charge (AC-4)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);

    const results = await Promise.all([
      start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET }),
      start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "job_in_progress" }]);
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    expect(jobs).toHaveLength(1);
    expect(jobs.reduce((sum, j) => sum + j.secondsCharged, 0)).toBe(62);
  });

  it("refuses takes that can't start: not probed, still uploading, expired", async () => {
    const creator = await createCreator(db);
    for (const overrides of [
      { status: "uploading" as const, durationMs: null },
      { status: "failed" as const, durationMs: null },
      { status: "expired" as const },
    ]) {
      const t = await seedTake(db, creator.id, overrides);
      expect(await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET })).toEqual(
        { ok: false, error: "invalid_transition" },
      );
    }
    const jobs = await db
      .select({ id: processingJob.id })
      .from(processingJob)
      .innerJoin(take, eq(take.id, processingJob.takeId))
      .where(eq(take.creatorId, creator.id));
    expect(jobs).toEqual([]);
  });

  it("re renders for free once an initial job succeeded", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const first = await startOk(creator.id, t.id);
    await seedRender(t.id, first.id);
    expect((await finish(db, { jobId: first.id, status: "succeeded" })).ok).toBe(true);

    const rerender = await startOk(creator.id, t.id);
    expect(rerender).toMatchObject({
      kind: "rerender",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
    });
    expect(rerender.steps.map((s) => s.name)).toEqual(["render"]);
  });

  it("does not charge a retry after a non refundable failure, but does after a refunded one", async () => {
    const creator = await createCreator(db);
    const paid = await seedTake(db, creator.id);
    const j1 = await startOk(creator.id, paid.id);
    await markRunning(db, { jobId: j1.id, triggerRunId: "run_1" });
    await cancel(db, { creatorId: creator.id, jobId: j1.id }); // cancelled_while_running: kept
    expect((await startOk(creator.id, paid.id)).secondsCharged).toBe(0);

    const refunded = await seedTake(db, creator.id);
    const j2 = await startOk(creator.id, refunded.id);
    await finish(db, { jobId: j2.id, status: "failed", failureCode: "ffmpeg_error" });
    expect((await startOk(creator.id, refunded.id)).secondsCharged).toBe(62);
  });
});

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
    // A step this job doesn't have (transcript is not live in slice 1).
    expect(
      await updateStep(db, { jobId: job.id, name: "transcript", status: "running", progress: 1 }),
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

describe("jobs.cancel (AC-13)", () => {
  it("refunds a cancel before the job runs", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);
    const result = await cancel(db, { creatorId: creator.id, jobId: job.id });
    expect(result.ok && result.data).toMatchObject({
      job: { status: "cancelled", failureCode: "cancelled_before_start", refunded: true },
      take: { status: "failed" },
      refundedSeconds: 62,
    });
    expect(await cancel(db, { creatorId: creator.id, jobId: job.id })).toEqual({
      ok: false,
      error: "already_final",
    });
  });

  it("does not refund a cancel while running", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);
    await markRunning(db, { jobId: job.id, triggerRunId: "run_x" });
    const result = await cancel(db, { creatorId: creator.id, jobId: job.id });
    expect(result.ok && result.data).toMatchObject({
      job: { status: "cancelled", failureCode: "cancelled_while_running", refunded: false },
      refundedSeconds: 0,
    });
  });
});

describe("ownership (AC-2)", () => {
  it("gives creator B not_found on creator A's take and job, and changes nothing", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    const t = await seedTake(db, a.id);

    expect(await start(db, { creatorId: b.id, takeId: t.id, usageSecret: SECRET })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await takeRow(t.id))?.status).toBe("uploaded");

    const job = await startOk(a.id, t.id);
    expect(await cancel(db, { creatorId: b.id, jobId: job.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    const [row] = await db
      .select()
      .from(processingJob)
      .where(and(eq(processingJob.id, job.id), eq(processingJob.status, "queued")));
    expect(row).toBeDefined();
  });

  it("treats malformed ids as not_found", async () => {
    const a = await createCreator(db);
    expect(await start(db, { creatorId: a.id, takeId: "x", usageSecret: SECRET })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await cancel(db, { creatorId: a.id, jobId: "x" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
