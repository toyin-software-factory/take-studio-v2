import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingJob, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { cancel, finish, markRunning, start } from ".";
import { NOW, SECRET } from "./jobs-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_jobs_cancel" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
async function startOk(creatorId: string, takeId: string) {
  const result = await start(db, { creatorId, takeId, usageSecret: SECRET, now: NOW });
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.data;
}
async function takeRow(id: string) {
  const [row] = await db.select().from(take).where(eq(take.id, id));
  return row;
}
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
describe("concurrent finishing (AC-4, AC-12, AC-13)", () => {
  it("lets one of two simultaneous finishes win, and refunds once", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);

    const results = await Promise.all([
      finish(db, { jobId: job.id, status: "failed", failureCode: "timeout" }),
      finish(db, { jobId: job.id, status: "failed", failureCode: "timeout" }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "already_final" }]);
    const refunded = results.reduce((sum, r) => sum + (r.ok ? r.data.refundedSeconds : 0), 0);
    expect(refunded).toBe(62);
  });

  it("lets either a cancel or a finish win when they race, never both", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startOk(creator.id, t.id);

    const [cancelled, finished] = await Promise.all([
      cancel(db, { creatorId: creator.id, jobId: job.id }),
      finish(db, { jobId: job.id, status: "failed", failureCode: "ffmpeg_error" }),
    ]);

    expect([cancelled.ok, finished.ok].filter(Boolean)).toHaveLength(1);
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    // Both codes are refundable, so whichever won refunded exactly once.
    expect(row).toMatchObject({ refunded: true });
    expect(["cancelled", "failed"]).toContain(row?.status);
  });

  it("refuses a second start on a take that is already processing, without a second charge", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    await startOk(creator.id, t.id);

    expect(await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET })).toEqual({
      ok: false,
      error: "job_in_progress",
    });
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    expect(jobs).toHaveLength(1);
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
