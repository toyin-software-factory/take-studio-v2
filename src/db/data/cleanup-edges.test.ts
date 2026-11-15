import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { thumbnailKey } from "@/lib/take-rules";
import { processingJob, storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { expireDueTakes, failAbandonedUploads } from "./cleanup";
import { drainDeletions } from "./deletion";
import { dispatchJob } from "./dispatch";
import { finish } from "./jobs";
import { NOW, minutes, notStored } from "./cleanup-test-helpers";

/**
 * These sweep whole tables, so they use their own database and start each test empty.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup_5" });
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
