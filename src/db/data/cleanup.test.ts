import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLEANUP, cleanupCutoffs } from "@/lib/cleanup-rules";
import { processingJob, storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { failAbandonedUploads, failStaleJobs, recoverStuckUploads } from "./cleanup";
import { NOW, minutes, notStored } from "./cleanup-test-helpers";

/**
 * These sweep whole tables, so they use their own database and start each test empty.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup" });
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
async function queuedKeys(): Promise<string[]> {
  const rows = await db.select({ key: storageDeletion.objectKey }).from(storageDeletion);
  return rows.map((row) => row.key).sort();
}
describe("cleanup: abandoned uploads (AC-18)", () => {
  const idleMin = CLEANUP.uploadIdleMs / 60_000; // the link lifetime plus a margin
  const backstopMin = CLEANUP.uploadBackstopMs / 60_000; // 6 hours
  const uploading = async (creatorId: string, over: Record<string, unknown>) =>
    seedTake(db, creatorId, { status: "uploading", durationMs: null, ...over });
  const statusOf = async (id: string) =>
    (await db.select().from(take).where(eq(take.id, id)))[0]?.status;

  it("fails an upload idle past the link lifetime plus margin, returning what to abort", async () => {
    const creator = await createCreator(db);
    const idle = await uploading(creator.id, {
      uploadId: "mpu-idle",
      createdAt: minutes(idleMin + 30),
      updatedAt: minutes(idleMin + 1),
    });
    const active = await uploading(creator.id, {
      uploadId: "mpu-active",
      createdAt: minutes(idleMin + 30),
      updatedAt: minutes(idleMin - 1),
    });

    const abandoned = await failAbandonedUploads(db, NOW, notStored);

    expect(abandoned).toEqual([
      { takeId: idle.id, originalKey: idle.originalKey, uploadId: "mpu-idle" },
    ]);
    const [idleRow] = await db.select().from(take).where(eq(take.id, idle.id));
    expect(idleRow).toMatchObject({
      status: "failed",
      failureCode: "upload_abandoned",
      uploadId: null,
    });
    expect(await statusOf(active.id)).toBe("uploading");
    expect(await queuedKeys()).toEqual([idle.originalKey]);
  });

  it("does not fail a slow upload older than 90 minutes that asked for part links recently", async () => {
    const creator = await createCreator(db);
    const slow = await uploading(creator.id, {
      uploadId: "mpu-slow",
      createdAt: minutes(100), // past the old 75 minute limit
      updatedAt: minutes(2), // part links were issued two minutes ago
    });
    expect(await failAbandonedUploads(db, NOW, notStored)).toEqual([]);
    expect(await statusOf(slow.id)).toBe("uploading");
    expect(await queuedKeys()).toEqual([]);
  });

  it("fails an upload past the 6 hour backstop even when it is still active", async () => {
    const creator = await createCreator(db);
    const forever = await uploading(creator.id, {
      uploadId: "mpu-forever",
      createdAt: minutes(backstopMin + 1),
      updatedAt: minutes(1),
    });
    const justInside = await uploading(creator.id, {
      uploadId: "mpu-inside",
      createdAt: minutes(backstopMin - 1),
      updatedAt: minutes(1),
    });
    const abandoned = await failAbandonedUploads(db, NOW, notStored);
    expect(abandoned.map((a) => a.takeId)).toEqual([forever.id]);
    expect(abandoned[0]?.uploadId).toBe("mpu-forever");
    expect(await statusOf(justInside.id)).toBe("uploading");
  });

  it("still never fails an upload whose original is stored at the stated size (recovery's)", async () => {
    const creator = await createCreator(db);
    const done = await uploading(creator.id, {
      uploadId: "mpu-done",
      createdAt: minutes(backstopMin + 60),
      updatedAt: minutes(idleMin + 60),
    });
    const stored = async () => ({ size: Number(done.originalBytes) });
    expect(await failAbandonedUploads(db, NOW, stored)).toEqual([]);
    expect(await statusOf(done.id)).toBe("uploading");
  });
});
describe("cleanup: stuck upload recovery next to the idle rule (S1C-T09, AC-18)", () => {
  const ports = (stored: Set<string>, dispatched: string[]) => ({
    headObject: async (key: string) => (stored.has(key) ? { size: 1000 } : null),
    dispatchProbe: async (takeId: string) => void dispatched.push(takeId),
  });

  it("leaves an idle upload that never finished alone (nothing is stored), for the idle rule", async () => {
    const creator = await createCreator(db);
    const idle = await seedTake(db, creator.id, {
      status: "uploading",
      durationMs: null,
      originalBytes: 1000,
      updatedAt: minutes(CLEANUP.uploadIdleMs / 60_000 + 5),
    });
    const dispatched: string[] = [];
    const result = await recoverStuckUploads(db, NOW, ports(new Set(), dispatched));
    expect(result.redispatched).not.toContain(idle.id);
    expect(dispatched).not.toContain(idle.id);
    // Not touched either: the idle rule still sees it as idle.
    const [row] = await db.select().from(take).where(eq(take.id, idle.id));
    expect(row?.updatedAt.getTime()).toBe(minutes(CLEANUP.uploadIdleMs / 60_000 + 5).getTime());
    expect(await failAbandonedUploads(db, NOW, notStored)).toEqual(
      expect.arrayContaining([expect.objectContaining({ takeId: idle.id })]),
    );
  });

  it("still re-dispatches a completed upload that was never probed, whatever its age", async () => {
    const creator = await createCreator(db);
    const done = await seedTake(db, creator.id, {
      status: "uploading",
      durationMs: null,
      originalBytes: 1000,
      createdAt: minutes(CLEANUP.uploadBackstopMs / 60_000 + 120),
      updatedAt: minutes(10),
    });
    const dispatched: string[] = [];
    const result = await recoverStuckUploads(
      db,
      NOW,
      ports(new Set([done.originalKey]), dispatched),
    );
    expect(result.redispatched).toContain(done.id);
    expect(await failAbandonedUploads(db, NOW, async () => ({ size: 1000 }))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ takeId: done.id })]),
    );
  });
});
describe("cleanup: stale jobs (AC-18)", () => {
  it("fails stuck queued and running jobs with stale_run and refunds them; leaves live ones", async () => {
    const creator = await createCreator(db);
    const { queuedJobBefore, runningJobBefore } = cleanupCutoffs(NOW);
    const before = (d: Date) => new Date(d.getTime() - 1000);
    const after = (d: Date) => new Date(d.getTime() + 1000);

    const t1 = await seedTake(db, creator.id, { status: "processing" });
    const staleQueued = await seedJob(t1.id, {
      status: "queued",
      createdAt: before(queuedJobBefore),
    });
    const t2 = await seedTake(db, creator.id, { status: "processing" });
    const staleRunning = await seedJob(t2.id, {
      status: "running",
      startedAt: before(runningJobBefore),
      triggerRunId: "run_stale",
    });
    const t3 = await seedTake(db, creator.id, { status: "processing" });
    const live = await seedJob(t3.id, { status: "running", startedAt: after(runningJobBefore) });

    const stale = await failStaleJobs(db, NOW);

    expect(stale.map((j) => j.jobId).sort()).toEqual([staleQueued.id, staleRunning.id].sort());
    expect(stale.find((j) => j.jobId === staleRunning.id)).toMatchObject({
      runId: "run_stale",
      refundedSeconds: 62,
    });
    const rows = await db
      .select()
      .from(processingJob)
      .where(inArray(processingJob.id, [staleQueued.id, staleRunning.id, live.id]));
    expect(rows.find((r) => r.id === staleQueued.id)).toMatchObject({
      status: "failed",
      failureCode: "stale_run",
      refunded: true,
    });
    expect(rows.find((r) => r.id === live.id)?.status).toBe("running");
    const [takeRow] = await db.select().from(take).where(eq(take.id, t1.id));
    expect(takeRow?.status).toBe("failed");
  });
});
