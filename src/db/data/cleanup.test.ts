import { and, eq, inArray, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLEANUP, PROBE_LIMITS, cleanupCutoffs } from "@/lib/cleanup-rules";
import { thumbnailKey } from "@/lib/take-rules";
import { cut, processingJob, render, storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import {
  expireDueTakes,
  failAbandonedUploads,
  failStaleJobs,
  recoverStuckUploads,
} from "./cleanup";
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

/** Storage that has no object: an upload that never completed. */
const notStored = async () => null;

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

    expect(await expireDueTakes(db, NOW)).toEqual({ expired: 1, queuedKeys: 3 });

    const takes = await db
      .select()
      .from(take)
      .where(inArray(take.id, [due.id, busy.id, later.id]));
    expect(Object.fromEntries(takes.map((t) => [t.id, t.status]))).toEqual({
      [due.id]: "expired",
      [busy.id]: "processing",
      [later.id]: "ready",
    });
    expect(await queuedKeys()).toEqual([due.originalKey, renderKey, thumbnailKey(due.id)].sort());
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

describe("cleanup: transcribe jobs (spec 0007)", () => {
  it("has its own stale cutoff: 50 minutes, against 85 for the video kinds", async () => {
    const cutoffs = cleanupCutoffs(NOW);
    expect(NOW.getTime() - cutoffs.transcribeRunningJobBefore.getTime()).toBe(50 * 60 * 1000);
    expect(NOW.getTime() - cutoffs.runningJobBefore.getTime()).toBe(85 * 60 * 1000);

    const creator = await createCreator(db);
    const stuck = await seedTake(db, creator.id, { status: "ready" });
    const stuckJob = await seedJob(stuck.id, {
      kind: "transcribe",
      status: "running",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
      startedAt: minutes(55),
    });
    const fresh = await seedTake(db, creator.id, { status: "ready" });
    const freshJob = await seedJob(fresh.id, {
      kind: "transcribe",
      status: "running",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
      startedAt: minutes(40),
    });
    // The same 55 minutes is still fine for a video job.
    const video = await seedTake(db, creator.id, { status: "processing" });
    const videoJob = await seedJob(video.id, { status: "running", startedAt: minutes(55) });

    const stale = await failStaleJobs(db, NOW);

    expect(stale.map((j) => j.jobId)).toEqual([stuckJob.id]);
    expect(stale[0]).toMatchObject({ kind: "transcribe", refundedSeconds: 0 });
    const [stuckRow] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, stuckJob.id));
    expect(stuckRow).toMatchObject({ status: "failed", failureCode: "stale_run", refunded: false });
    const statuses = await db
      .select({ id: processingJob.id, status: processingJob.status })
      .from(processingJob)
      .where(inArray(processingJob.id, [freshJob.id, videoJob.id]));
    expect(statuses.every((r) => r.status === "running")).toBe(true);
    // A stale transcribe job never moves its take.
    const [takeRow] = await db.select().from(take).where(eq(take.id, stuck.id));
    expect(takeRow).toMatchObject({ status: "ready", failureCode: null });
  });

  it("fails a transcribe job that stayed queued past the pick up window, without moving the take", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "ready" });
    const job = await seedJob(t.id, {
      kind: "transcribe",
      status: "queued",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
      createdAt: minutes(20),
    });
    const stale = await failStaleJobs(db, NOW);
    expect(stale).toEqual([expect.objectContaining({ jobId: job.id, kind: "transcribe" })]);
    const [takeRow] = await db.select().from(take).where(eq(take.id, t.id));
    expect(takeRow?.status).toBe("ready");
  });

  it("does not expire a take while a transcribe job runs, and expires it on the next sweep after", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "ready", videoExpiresAt: minutes(1) });
    const job = await seedJob(t.id, {
      kind: "transcribe",
      status: "running",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
      startedAt: minutes(2),
    });

    expect(await expireDueTakes(db, NOW)).toEqual({ expired: 0, queuedKeys: 0 });
    // Even called directly, the take is refused while a job of any kind is active.
    expect(await expireTake(db, { takeId: t.id })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    const [before] = await db.select().from(take).where(eq(take.id, t.id));
    expect(before?.status).toBe("ready");

    await finish(db, { jobId: job.id, status: "succeeded" });
    const swept = await expireDueTakes(db, NOW);
    expect(swept.expired).toBe(1);
    const [after] = await db.select().from(take).where(eq(take.id, t.id));
    expect(after?.status).toBe("expired");
  });

  it("still expires other due takes in the same sweep", async () => {
    const creator = await createCreator(db);
    const busy = await seedTake(db, creator.id, { status: "ready", videoExpiresAt: minutes(1) });
    await seedJob(busy.id, {
      kind: "transcribe",
      status: "queued",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
    });
    const idle = await seedTake(db, creator.id, { status: "ready", videoExpiresAt: minutes(1) });
    const swept = await expireDueTakes(db, NOW);
    expect(swept.expired).toBe(1);
    const [row] = await db.select().from(take).where(eq(take.id, idle.id));
    expect(row?.status).toBe("expired");
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

    expect(await expireDueTakes(db, NOW)).toEqual({ expired: 1, queuedKeys: 2 });
    const rows = await db
      .select()
      .from(take)
      .where(inArray(take.id, [uploaded.id, neverUploaded.id]));
    expect(Object.fromEntries(rows.map((t) => [t.id, t.status]))).toEqual({
      [uploaded.id]: "expired",
      [neverUploaded.id]: "failed",
    });
    expect(await queuedKeys()).toEqual([uploaded.originalKey, thumbnailKey(uploaded.id)].sort());
  });

  it("leaves an old take alone once its upload has completed", async () => {
    const creator = await createCreator(db);
    const done = await seedTake(db, creator.id, { status: "uploaded", createdAt: minutes(500) });
    expect(await failAbandonedUploads(db, NOW, notStored)).toEqual([]);
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

  it("hands the job's creator to the trigger, so two creators get two queues (HRF-T01)", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const trigger = async (jobId: string, creatorId?: string) => {
      seen.push([jobId, creatorId]);
      return { id: `run_${jobId}` };
    };
    const a = await createCreator(db);
    const b = await createCreator(db);
    const jobs = [];
    for (const c of [a, b]) {
      const t = await seedTake(db, c.id, { status: "processing" });
      jobs.push(await seedJob(t.id, {}));
    }
    for (const job of jobs) await dispatchJob(db, { jobId: job.id, trigger });
    expect(seen).toEqual([
      [jobs[0]!.id, a.id],
      [jobs[1]!.id, b.id],
    ]);
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

describe("cleanup: takes stuck in uploading after a failed probe dispatch (S1C-T09)", () => {
  /** An `uploading` take quiet for `quiet` minutes, created `age` minutes ago. */
  async function seedStuck(
    creatorId: string,
    values: Partial<typeof take.$inferInsert> = {},
    age = 30,
    quiet = 10,
  ) {
    return seedTake(db, creatorId, {
      status: "uploading",
      uploadId: "upload-1",
      durationMs: null,
      videoExpiresAt: null,
      createdAt: minutes(age),
      updatedAt: minutes(quiet),
      ...values,
    });
  }

  function ports(options: { stored?: boolean; headFails?: boolean; dispatchFails?: boolean } = {}) {
    const dispatched: { takeId: string; redispatch: number }[] = [];
    return {
      dispatched,
      headObject: async (_key: string) => {
        if (options.headFails) throw new Error("r2 down");
        return options.stored === false ? null : { size: 1_000_000 };
      },
      dispatchProbe: async (takeId: string, redispatch: number) => {
        dispatched.push({ takeId, redispatch });
        if (options.dispatchFails) throw new Error("trigger down");
      },
    };
  }

  const probeAttemptsOf = async (id: string) =>
    (await db.select().from(take).where(eq(take.id, id)))[0]!;

  it("re-dispatches the probe once with a fresh key and counts the attempt", async () => {
    const creator = await createCreator(db);
    const stuck = await seedStuck(creator.id);
    const p = ports();
    const result = await recoverStuckUploads(db, NOW, p);
    expect(result).toEqual({ redispatched: [stuck.id], failed: [] });
    expect(p.dispatched).toEqual([{ takeId: stuck.id, redispatch: 1 }]);
    const row = await probeAttemptsOf(stuck.id);
    expect(row).toMatchObject({ status: "uploading", probeAttempts: 1 });
  });

  it("is picked up within one cleanup run even when older than the abandoned cut off", async () => {
    const creator = await createCreator(db);
    const old = await seedStuck(creator.id, {}, 200, 100); // old and idle, but stored
    const p = ports();
    const recovery = await recoverStuckUploads(db, NOW, p);
    const abandoned = await failAbandonedUploads(db, NOW, p.headObject);
    expect(recovery.redispatched).toEqual([old.id]);
    expect(abandoned).toEqual([]);
    expect((await probeAttemptsOf(old.id)).status).toBe("uploading");
    expect(await queuedKeys()).toEqual([]);
  });

  it("counts each pass, and fails the take refundably with internal_error after 3 re-dispatches", async () => {
    const creator = await createCreator(db);
    const grace = CLEANUP.lastProbeGraceMs / 60_000;
    const stuck = await seedStuck(creator.id, { probeAttempts: 3 }, 200, grace + 1);
    const p = ports();
    const result = await recoverStuckUploads(db, NOW, p);
    expect(result).toEqual({ redispatched: [], failed: [stuck.id] });
    expect(p.dispatched).toEqual([]);
    expect(await probeAttemptsOf(stuck.id)).toMatchObject({
      status: "failed",
      failureCode: "internal_error",
      uploadId: null,
    });
    expect(await queuedKeys()).toEqual([stuck.originalKey]);
  });

  it("walks attempts 1, 2, 3 across runs, then fails", async () => {
    const creator = await createCreator(db);
    // Real time: each attempt bumps updated_at to the real clock, so the passes must follow it.
    const start = new Date();
    const stuck = await seedStuck(creator.id, {
      createdAt: new Date(start.getTime() - 30 * 60_000),
      updatedAt: new Date(start.getTime() - 10 * 60_000),
    });
    const p = ports();
    let now = start;
    for (let pass = 1; pass <= 3; pass += 1) {
      await recoverStuckUploads(db, now, p);
      now = new Date(now.getTime() + 15 * 60_000); // next cleanup, past the quiet time again
    }
    expect(p.dispatched.map((d) => d.redispatch)).toEqual([1, 2, 3]);
    const last = await recoverStuckUploads(db, now, p);
    expect(last.failed).toEqual([stuck.id]);
    expect((await probeAttemptsOf(stuck.id)).status).toBe("failed");
  });

  it("leaves a take that is not quiet yet, and one whose upload never completed", async () => {
    const creator = await createCreator(db);
    const fresh = await seedStuck(creator.id, {}, 30, 1); // updated a minute ago
    const incomplete = await seedStuck(creator.id);
    const p = ports({ stored: false });
    expect(await recoverStuckUploads(db, NOW, p)).toEqual({ redispatched: [], failed: [] });
    expect(p.dispatched).toEqual([]);
    expect((await probeAttemptsOf(fresh.id)).probeAttempts).toBe(0);
    // The abandoned rule still handles the one that never completed (once idle long enough).
    await db
      .update(take)
      .set({ createdAt: minutes(200), updatedAt: minutes(200) })
      .where(eq(take.id, incomplete.id));
    const abandoned = await failAbandonedUploads(db, NOW, p.headObject);
    expect(abandoned.map((a) => a.takeId)).toEqual([incomplete.id]);
  });

  it("ignores a stored object whose size differs, and takes in other states", async () => {
    const creator = await createCreator(db);
    const wrongSize = await seedStuck(creator.id, { originalBytes: 5 });
    const uploaded = await seedTake(db, creator.id, { updatedAt: minutes(60) });
    const result = await recoverStuckUploads(db, NOW, ports());
    expect(result.redispatched).toEqual([]);
    expect((await probeAttemptsOf(wrongSize.id)).probeAttempts).toBe(0);
    expect((await probeAttemptsOf(uploaded.id)).status).toBe("uploaded");
  });

  it("still counts the attempt when the dispatch throws, so attempts stay bounded", async () => {
    const creator = await createCreator(db);
    const stuck = await seedStuck(creator.id);
    const result = await recoverStuckUploads(db, NOW, ports({ dispatchFails: true }));
    expect(result.redispatched).toEqual([stuck.id]);
    expect((await probeAttemptsOf(stuck.id)).probeAttempts).toBe(1);
  });

  it("skips a take it cannot check, and the abandoned rule leaves it too", async () => {
    const creator = await createCreator(db);
    const unknown = await seedStuck(creator.id, {}, 200, 100);
    const recovery = await recoverStuckUploads(db, NOW, ports({ headFails: true }));
    expect(recovery).toEqual({ redispatched: [], failed: [] });
    // The abandoned rule checks storage itself and cannot tell either: it leaves the take.
    expect(await failAbandonedUploads(db, NOW, ports({ headFails: true }).headObject)).toEqual([]);
    expect((await probeAttemptsOf(unknown.id)).status).toBe("uploading");
  });

  it("never counts the same attempt twice when two runs race", async () => {
    const creator = await createCreator(db);
    // Real time here: the attempt bumps updated_at to the real clock, which is what keeps a
    // second run from picking the take up again within the quiet time.
    const now = new Date();
    const ago = (n: number) => new Date(now.getTime() - n * 60 * 1000);
    const stuck = await seedStuck(creator.id, { createdAt: ago(30), updatedAt: ago(10) });
    const p = ports();
    await Promise.all([recoverStuckUploads(db, now, p), recoverStuckUploads(db, now, p)]);
    expect((await probeAttemptsOf(stuck.id)).probeAttempts).toBe(1);
    expect(p.dispatched).toHaveLength(1);
  });

  it("keeps the take while the last re-dispatched probe may still be running (grace period)", async () => {
    const creator = await createCreator(db);
    const grace = CLEANUP.lastProbeGraceMs / 60_000;
    const waiting = await seedStuck(creator.id, { probeAttempts: 3 }, 200, grace - 1);
    const p = ports();
    expect(await recoverStuckUploads(db, NOW, p)).toEqual({ redispatched: [], failed: [] });
    expect((await probeAttemptsOf(waiting.id)).status).toBe("uploading");
    expect(await queuedKeys()).toEqual([]);
    // Once the grace has passed, the next pass fails it.
    const later = new Date(NOW.getTime() + 2 * 60_000);
    expect((await recoverStuckUploads(db, later, p)).failed).toEqual([waiting.id]);
  });

  it("derives the grace from the probe's own limits (attempts x maxDuration + margin)", () => {
    expect(CLEANUP.lastProbeGraceMs).toBe(
      PROBE_LIMITS.maxAttempts * PROBE_LIMITS.maxDurationSeconds * 1000 + 5 * 60_000,
    );
  });

  it("never fails a stored original as abandoned, even beyond the recovery batch limit", async () => {
    const creator = await createCreator(db);
    // More stored, old takes than one recovery batch: the ones recovery does not reach this
    // run must still be safe, because the abandoned rule checks storage itself.
    const total = CLEANUP.batchSize + 5;
    await db.insert(take).values(
      Array.from({ length: total }, (_, n) => {
        const id = crypto.randomUUID();
        return {
          id,
          creatorId: creator.id,
          title: "Stuck",
          status: "uploading" as const,
          originalKey: `originals/${id}/source.mp4`,
          originalBytes: 1_000_000,
          uploadId: "upload-1",
          container: "mp4",
          createdAt: minutes(500 - n),
          updatedAt: minutes(10),
        };
      }),
    );
    const p = ports();
    const recovery = await recoverStuckUploads(db, NOW, p);
    expect(recovery.redispatched).toHaveLength(CLEANUP.batchSize);
    expect(await failAbandonedUploads(db, NOW, p.headObject)).toEqual([]);
    const rows = await db.select({ status: take.status }).from(take);
    expect(rows.every((row) => row.status === "uploading")).toBe(true);
    expect(await queuedKeys()).toEqual([]);
  });

  it("still fails a stored original of the wrong size as abandoned", async () => {
    const creator = await createCreator(db);
    const bad = await seedStuck(creator.id, { originalBytes: 5 }, 200, 100);
    const abandoned = await failAbandonedUploads(db, NOW, ports().headObject);
    expect(abandoned.map((a) => a.takeId)).toEqual([bad.id]);
  });

  it("moves a take whose storage check failed behind the others, so it cannot starve them", async () => {
    const creator = await createCreator(db);
    const broken = await seedStuck(creator.id, {}, 60, 30); // oldest updated_at
    const fine = await seedStuck(creator.id, {}, 50, 10);
    const base = ports();
    const p = {
      ...base,
      headObject: async (key: string) => {
        if (key === broken.originalKey) throw new Error("r2 error");
        return base.headObject(key);
      },
    };
    const result = await recoverStuckUploads(db, NOW, p);
    expect(result.redispatched).toEqual([fine.id]);
    // The broken one was touched: it now sorts after everything that was waiting.
    expect((await probeAttemptsOf(broken.id)).updatedAt.getTime()).toBe(NOW.getTime());
    expect((await probeAttemptsOf(broken.id)).status).toBe("uploading");
  });

  it("stops starting storage checks when the time budget is used up", async () => {
    const creator = await createCreator(db);
    for (let n = 0; n < 3; n += 1) await seedStuck(creator.id, {}, 60 - n, 30 - n);
    let ticks = 0;
    const clock = () => (ticks += 600); // each look at the clock costs 600 ms
    const p = ports();
    const result = await recoverStuckUploads(db, NOW, p, { budgetMs: 1000, clock });
    expect(result.redispatched).toHaveLength(1); // the rest wait for the next run
    expect(p.dispatched).toHaveLength(1);
    let t2 = 0;
    const abandoned = await failAbandonedUploads(db, NOW, notStored, {
      budgetMs: 0,
      clock: () => (t2 += 1),
    });
    expect(abandoned).toEqual([]); // no time left: nothing was started
  });
});
