import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupCutoffs } from "@/lib/cleanup-rules";
import { processingJob, storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { expireDueTakes, failStaleJobs } from "./cleanup";
import { drainDeletions, expireTake } from "./deletion";
import { finish } from "./jobs";
import { NOW, minutes } from "./cleanup-test-helpers";

/**
 * These sweep whole tables, so they use their own database and start each test empty.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup_4" });
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
