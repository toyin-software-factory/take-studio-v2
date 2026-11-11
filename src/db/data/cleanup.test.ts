import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLEANUP, cleanupCutoffs } from "@/lib/cleanup-rules";
import { cut, processingJob, render, storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { expireDueTakes, failAbandonedUploads, failStaleJobs } from "./cleanup";
import { drainDeletions, expireTake } from "./deletion";
import { dispatchJob } from "./dispatch";
import { finish } from "./jobs";

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
});

const NOW = new Date("2026-11-11T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() - n * 60 * 1000);

/** A job inserted directly (start() charges and needs a secret; not needed here). */
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
  it("fails uploads past the link lifetime plus margin, returning what to abort", async () => {
    const creator = await createCreator(db);
    const limit = CLEANUP.uploadLinkLifetimeMs / 60_000 + CLEANUP.uploadAbandonMarginMs / 60_000;
    const old = await seedTake(db, creator.id, {
      status: "uploading",
      durationMs: null,
      uploadId: "mpu-old",
      createdAt: minutes(limit + 1),
    });
    const fresh = await seedTake(db, creator.id, {
      status: "uploading",
      durationMs: null,
      uploadId: "mpu-new",
      createdAt: minutes(limit - 1),
    });

    const abandoned = await failAbandonedUploads(db, NOW);

    expect(abandoned).toEqual([
      { takeId: old.id, originalKey: old.originalKey, uploadId: "mpu-old" },
    ]);
    const [oldRow] = await db.select().from(take).where(eq(take.id, old.id));
    expect(oldRow).toMatchObject({
      status: "failed",
      failureCode: "upload_abandoned",
      uploadId: null,
    });
    const [freshRow] = await db.select().from(take).where(eq(take.id, fresh.id));
    expect(freshRow?.status).toBe("uploading");
    expect(await queuedKeys()).toEqual([old.originalKey]);
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

describe("cleanup: video expiry (AC-18)", () => {
  it("expires due takes, queues their files, clears render keys, and keeps cuts and render settings", async () => {
    const creator = await createCreator(db);
    const due = await seedTake(db, creator.id, { status: "ready", videoExpiresAt: minutes(1) });
    const job = await seedJob(due.id, { status: "succeeded" });
    const renderId = crypto.randomUUID();
    const renderKey = `renders/${due.id}/${renderId}.mp4`;
    await db.insert(render).values({
      id: renderId,
      takeId: due.id,
      jobId: job.id,
      status: "succeeded",
      videoKey: renderKey,
      removedRanges: [{ startMs: 0, endMs: 500 }],
      isLatest: true,
    });
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId: due.id,
      startMs: 0,
      endMs: 500,
      kind: "pause",
      proposedBy: "rules",
    });
    const busy = await seedTake(db, creator.id, {
      status: "processing",
      videoExpiresAt: minutes(1),
    });
    const later = await seedTake(db, creator.id, { status: "ready", videoExpiresAt: minutes(-60) });

    expect(await expireDueTakes(db, NOW)).toEqual({ expired: 1, queuedKeys: 2 });

    const takes = await db
      .select()
      .from(take)
      .where(inArray(take.id, [due.id, busy.id, later.id]));
    expect(Object.fromEntries(takes.map((t) => [t.id, t.status]))).toEqual({
      [due.id]: "expired",
      [busy.id]: "processing",
      [later.id]: "ready",
    });
    expect(await queuedKeys()).toEqual([due.originalKey, renderKey].sort());
    const [renderRow] = await db.select().from(render).where(eq(render.id, renderId));
    expect(renderRow).toMatchObject({
      videoKey: null,
      removedRanges: [{ startMs: 0, endMs: 500 }],
    });
    expect(await db.select().from(cut).where(eq(cut.takeId, due.id))).toHaveLength(1);
  });

  it("refuses to expire a processing take", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    expect(await expireTake(db, { takeId: t.id })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });
});

describe("storage deletion drain (AC-17)", () => {
  it("deletes objects and their rows, and retries failures later with attempts and error", async () => {
    await db.insert(storageDeletion).values([
      { id: crypto.randomUUID(), objectKey: "originals/a/source.mp4" },
      { id: crypto.randomUUID(), objectKey: "originals/b/source.mp4" },
      { id: crypto.randomUUID(), objectKey: "renders/c/d.mp4" },
    ]);
    const deletedKeys: string[] = [];
    const result = await drainDeletions(db, async (key) => {
      if (key.startsWith("renders/")) throw new Error("R2 delete failed: HTTP 503");
      deletedKeys.push(key);
    });

    expect(result).toEqual({ deleted: 2, failed: 1, stuck: 0 });
    expect(deletedKeys.sort()).toEqual(["originals/a/source.mp4", "originals/b/source.mp4"]);
    const left = await db.select().from(storageDeletion);
    expect(left).toEqual([
      expect.objectContaining({
        objectKey: "renders/c/d.mp4",
        attempts: 1,
        lastError: "R2 delete failed: HTTP 503",
      }),
    ]);

    // The next drain retries it.
    expect(await drainDeletions(db, async () => {})).toEqual({ deleted: 1, failed: 0, stuck: 0 });
    expect(await db.select().from(storageDeletion)).toEqual([]);
  });

  it("leaves rows that hit the attempt limit for a person, and counts them", async () => {
    await db
      .insert(storageDeletion)
      .values({ id: crypto.randomUUID(), objectKey: "x/stuck.mp4", attempts: 10 });
    let calls = 0;
    const result = await drainDeletions(db, async () => void calls++, { maxAttempts: 10 });
    expect(result).toEqual({ deleted: 0, failed: 0, stuck: 1 });
    expect(calls).toBe(0);
  });
});

describe("cleanup edges (AC-17, AC-18)", () => {
  it("drains a queue longer than one batch", async () => {
    await db.insert(storageDeletion).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: crypto.randomUUID(),
        objectKey: `originals/batch-${i}/source.mp4`,
      })),
    );
    const deleted: string[] = [];
    const result = await drainDeletions(db, async (key) => void deleted.push(key), {
      batchSize: 2,
    });
    expect(result).toEqual({ deleted: 5, failed: 0, stuck: 0 });
    expect(new Set(deleted).size).toBe(5);
    expect(await db.select().from(storageDeletion)).toEqual([]);
  });

  it("expires an uploaded take that was never processed, and never sweeps a take with no expiry", async () => {
    const creator = await createCreator(db);
    const uploaded = await seedTake(db, creator.id, {
      status: "uploaded",
      videoExpiresAt: minutes(5),
    });
    const neverUploaded = await seedTake(db, creator.id, {
      status: "failed",
      failureCode: "upload_abandoned",
      durationMs: null,
      videoExpiresAt: null,
    });

    expect(await expireDueTakes(db, NOW)).toEqual({ expired: 1, queuedKeys: 1 });
    const rows = await db
      .select()
      .from(take)
      .where(inArray(take.id, [uploaded.id, neverUploaded.id]));
    expect(Object.fromEntries(rows.map((t) => [t.id, t.status]))).toEqual({
      [uploaded.id]: "expired",
      [neverUploaded.id]: "failed",
    });
    expect(await queuedKeys()).toEqual([uploaded.originalKey]);
  });

  it("leaves an old take alone once its upload has completed", async () => {
    const creator = await createCreator(db);
    const done = await seedTake(db, creator.id, { status: "uploaded", createdAt: minutes(500) });
    expect(await failAbandonedUploads(db, NOW)).toEqual([]);
    const [row] = await db.select().from(take).where(eq(take.id, done.id));
    expect(row?.status).toBe("uploaded");
  });
});

describe("dispatchJob", () => {
  it("records the run ID when triggering works", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    const job = await seedJob(t.id, {});
    expect(
      await dispatchJob(db, { jobId: job.id, trigger: async () => ({ id: "run_ok" }) }),
    ).toEqual({
      ok: true,
      data: { runId: "run_ok" },
    });
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(row?.triggerRunId).toBe("run_ok");
  });

  it("finishes the job with trigger_failed and refunds when triggering fails", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    const job = await seedJob(t.id, {});
    const result = await dispatchJob(db, {
      jobId: job.id,
      trigger: async () => {
        throw new Error("Trigger.dev unavailable");
      },
    });
    expect(result).toEqual({ ok: false, error: "trigger_failed" });
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(row).toMatchObject({ status: "failed", failureCode: "trigger_failed", refunded: true });
    const [takeRow] = await db.select().from(take).where(eq(take.id, t.id));
    expect(takeRow?.status).toBe("failed");
    // Finishing again is refused, so the refund can't repeat.
    expect(
      await finish(db, { jobId: job.id, status: "failed", failureCode: "trigger_failed" }),
    ).toEqual({
      ok: false,
      error: "already_final",
    });
  });
});
