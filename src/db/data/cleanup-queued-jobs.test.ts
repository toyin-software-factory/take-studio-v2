import { and, eq, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLEANUP, cleanupCutoffs } from "@/lib/cleanup-rules";
import { processingJob, storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { failStaleJobs } from "./cleanup";
import { NOW } from "./cleanup-test-helpers";

/**
 * These sweep whole tables, so they use their own database and start each test empty.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup_2" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
beforeEach(async () => {
  await db.delete(take);
  await db.delete(storageDeletion);
}); /** A job inserted directly (start() charges and needs a secret; not needed here). */
async function seedJob(takeId: string, values: Partial<typeof processingJob.$inferInsert>) {
  const [row] = await db
    .insert(processingJob)
    .values({
      id: crypto.randomUUID(),
      takeId,
      kind: "initial",
      status: "queued",
      secondsCharged: 62,
      chargedMonth: "2026-11-01",
      chargedAccountHash: "hash",
      ...values,
    })
    .returning();
  if (!row) throw new Error("seedJob");
  return row;
}
describe("cleanup: queued jobs behind a creator's limit (HRF-T01)", () => {
  const { queuedJobBefore, queuedBackstopBefore, runningJobBefore } = cleanupCutoffs(NOW);
  const minus = (d: Date, ms: number) => new Date(d.getTime() - ms);
  // Other tests leave stale queued rows behind; this block counts lookups, so start clean.
  const clean = () =>
    db
      .delete(processingJob)
      .where(and(eq(processingJob.status, "queued"), lt(processingJob.createdAt, queuedJobBefore)));
  beforeEach(clean);
  afterEach(clean);

  const queuedJob = async (over: Partial<typeof processingJob.$inferInsert>) => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    return seedJob(t.id, { status: "queued", createdAt: minus(queuedJobBefore, 1000), ...over });
  };

  it("does not fail a queued job whose run is still waiting, but fails ended runs, no run and the backstop", async () => {
    const waitingRun = await queuedJob({ triggerRunId: "run_waiting" });
    const endedRun = await queuedJob({ triggerRunId: "run_ended" });
    const noRun = await queuedJob({ triggerRunId: null });
    const past = await queuedJob({
      createdAt: minus(queuedBackstopBefore, 1000),
      triggerRunId: "run_waiting",
    });
    const asked: string[] = [];
    const failed = await failStaleJobs(db, NOW, async (runId) => {
      asked.push(runId);
      return runId === "run_waiting";
    });
    const ids = new Set(failed.map((j) => j.jobId));
    expect(ids.has(waitingRun.id)).toBe(false);
    expect(ids.has(endedRun.id)).toBe(true);
    expect(ids.has(noRun.id)).toBe(true);
    // Past the 6 hour backstop it is failed without asking, even though its run looks alive.
    expect(ids.has(past.id)).toBe(true);
    expect(asked.sort()).toEqual(["run_ended", "run_waiting"]);
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, waitingRun.id));
    expect(row).toMatchObject({ status: "queued", failureCode: null });
  });

  it("without the check a queued job past 15 minutes is stale, as before", async () => {
    const job = await queuedJob({ triggerRunId: "run_waiting" });
    const failed = await failStaleJobs(db, NOW);
    expect(failed.map((j) => j.jobId)).toEqual([job.id]);
  });

  it("retained waiting jobs cannot crowd out a stale running job, the lookups per sweep are bounded, and every job is reached in turn", async () => {
    const limit = CLEANUP.queuedRunChecksPerSweep;
    // More waiting jobs than one batch (100), the oldest of all, and the ended one is the last
    // in line (most recently checked).
    const waiting: string[] = [];
    for (let i = 0; i < 105; i += 1) {
      const runId = i === 104 ? "run_ended" : `run_wait_${i}`;
      await queuedJob({
        triggerRunId: runId,
        createdAt: minus(queuedJobBefore, 60_000 + (200 - i) * 1000),
        updatedAt: minus(NOW, (200 - i) * 1000),
      });
      waiting.push(runId);
    }
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    const running = await seedJob(t.id, {
      status: "running",
      startedAt: minus(runningJobBefore, 1000),
      triggerRunId: "run_old_running",
    });

    const sweeps: string[][] = [];
    let ended: readonly { jobId: string }[] = [];
    for (let sweep = 0; sweep < 5; sweep += 1) {
      const asked: string[] = [];
      const failed = await failStaleJobs(db, NOW, async (runId) => {
        asked.push(runId);
        return runId !== "run_ended";
      });
      sweeps.push(asked);
      if (sweep === 0) {
        // The stale running job is failed in the first sweep, whatever waits ahead of it.
        expect(failed.map((j) => j.jobId)).toEqual([running.id]);
      }
      if (failed.some((j) => j.jobId !== running.id)) ended = failed;
    }
    for (const asked of sweeps) expect(asked.length).toBeLessThanOrEqual(limit);
    // The first four sweeps ask about different jobs each (least recently checked first).
    const firstFour = sweeps.slice(0, 4).flat();
    expect(new Set(firstFour).size).toBe(firstFour.length);
    expect(sweeps[0]).toEqual(waiting.slice(0, limit));
    // The ended run is the last in line and is reached by the fifth sweep.
    expect(ended).toHaveLength(1);
    expect(sweeps[4]).toContain("run_ended");
  }, 60_000);
});
describe("cleanup: running jobs past their limit (RF3-T01)", () => {
  const { runningJobBefore, runningBackstopBefore } = cleanupCutoffs(NOW);
  const minus = (d: Date, ms: number) => new Date(d.getTime() - ms);
  const clean = () =>
    db
      .delete(processingJob)
      .where(and(eq(processingJob.status, "running"), lt(processingJob.startedAt, NOW)));
  beforeEach(clean);
  afterEach(clean);

  const runningJob = async (over: Partial<typeof processingJob.$inferInsert>) => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    return seedJob(t.id, {
      status: "running",
      startedAt: minus(runningJobBefore, 1000),
      ...over,
    });
  };

  it("keeps a job whose run is alive, fails an ended run, and fails past the backstop without asking", async () => {
    const alive = await runningJob({ triggerRunId: "run_alive" });
    const ended = await runningJob({ triggerRunId: "run_ended" });
    const past = await runningJob({
      triggerRunId: "run_alive",
      startedAt: minus(runningBackstopBefore, 1000),
    });
    const asked: string[] = [];
    const failed = await failStaleJobs(db, NOW, undefined, async (runId) => {
      asked.push(runId);
      return runId === "run_alive";
    });
    const ids = new Set(failed.map((j) => j.jobId));
    expect(ids.has(alive.id)).toBe(false);
    expect(ids.has(ended.id)).toBe(true);
    expect(ids.has(past.id)).toBe(true);
    expect(asked.sort()).toEqual(["run_alive", "run_ended"]);
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, alive.id));
    expect(row).toMatchObject({ status: "running", failureCode: null });
  });

  it("without the check, or without a run ID, a running job past its limit is stale as before", async () => {
    const withRun = await runningJob({ triggerRunId: "run_alive" });
    const noRun = await runningJob({ triggerRunId: null });
    const failed = await failStaleJobs(db, NOW);
    expect(failed.map((j) => j.jobId).sort()).toEqual([withRun.id, noRun.id].sort());
  });

  it("shares the lookup cap with queued jobs", async () => {
    const limit = CLEANUP.queuedRunChecksPerSweep;
    const { queuedJobBefore } = cleanupCutoffs(NOW);
    for (let i = 0; i < limit; i += 1) await runningJob({ triggerRunId: `run_r${i}` });
    const creator = await createCreator(db);
    for (let i = 0; i < limit; i += 1) {
      const t = await seedTake(db, creator.id, { status: "processing" });
      await seedJob(t.id, {
        status: "queued",
        triggerRunId: `run_q${i}`,
        createdAt: minus(queuedJobBefore, 1000),
      });
    }
    let asked = 0;
    await failStaleJobs(
      db,
      NOW,
      async () => ((asked += 1), true),
      async () => ((asked += 1), true),
    );
    expect(asked).toBe(limit);
    await db.delete(processingJob).where(eq(processingJob.status, "queued"));
  });
});
