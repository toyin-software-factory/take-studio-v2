import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLEANUP, cleanupCutoffs } from "@/lib/cleanup-rules";
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
    expect(result).toEqual({ redispatched: [stuck.id], failed: [], owned: [stuck.id] });
    expect(p.dispatched).toEqual([{ takeId: stuck.id, redispatch: 1 }]);
    const row = await probeAttemptsOf(stuck.id);
    expect(row).toMatchObject({ status: "uploading", probeAttempts: 1 });
  });

  it("is picked up within one cleanup run even when older than the abandoned cut off", async () => {
    const creator = await createCreator(db);
    const old = await seedStuck(creator.id, {}, 200); // way past link lifetime + margin
    const recovery = await recoverStuckUploads(db, NOW, ports());
    const abandoned = await failAbandonedUploads(db, NOW, recovery.owned);
    expect(recovery.redispatched).toEqual([old.id]);
    expect(abandoned).toEqual([]);
    expect((await probeAttemptsOf(old.id)).status).toBe("uploading");
    expect(await queuedKeys()).toEqual([]);
  });

  it("counts each pass, and fails the take refundably with internal_error after 3 re-dispatches", async () => {
    const creator = await createCreator(db);
    const stuck = await seedStuck(creator.id, { probeAttempts: 3 });
    const p = ports();
    const result = await recoverStuckUploads(db, NOW, p);
    expect(result).toEqual({ redispatched: [], failed: [stuck.id], owned: [stuck.id] });
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
    expect(await recoverStuckUploads(db, NOW, p)).toEqual({
      redispatched: [],
      failed: [],
      owned: [],
    });
    expect(p.dispatched).toEqual([]);
    expect((await probeAttemptsOf(fresh.id)).probeAttempts).toBe(0);
    // The abandoned rule still handles the one that never completed (once old enough).
    await db
      .update(take)
      .set({ createdAt: minutes(200) })
      .where(eq(take.id, incomplete.id));
    const abandoned = await failAbandonedUploads(db, NOW, []);
    expect(abandoned.map((a) => a.takeId)).toEqual([incomplete.id]);
  });

  it("ignores a stored object whose size differs, and takes in other states", async () => {
    const creator = await createCreator(db);
    const wrongSize = await seedStuck(creator.id, { originalBytes: 5 });
    const uploaded = await seedTake(db, creator.id, { updatedAt: minutes(60) });
    const result = await recoverStuckUploads(db, NOW, ports());
    expect(result.redispatched).toEqual([]);
    expect(result.owned).toEqual([]);
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

  it("skips a take it cannot check and keeps the abandoned rule off it this run", async () => {
    const creator = await createCreator(db);
    const unknown = await seedStuck(creator.id, {}, 200);
    const recovery = await recoverStuckUploads(db, NOW, ports({ headFails: true }));
    expect(recovery).toEqual({ redispatched: [], failed: [], owned: [unknown.id] });
    expect(await failAbandonedUploads(db, NOW, recovery.owned)).toEqual([]);
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
});
