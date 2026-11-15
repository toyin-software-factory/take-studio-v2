import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLEANUP, PROBE_LIMITS } from "@/lib/cleanup-rules";
import { storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { failAbandonedUploads, recoverStuckUploads } from "./cleanup";
import { NOW, minutes } from "./cleanup-test-helpers";

/**
 * These sweep whole tables, so they use their own database and start each test empty.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup_6" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
beforeEach(async () => {
  await db.delete(take);
  await db.delete(storageDeletion);
});
async function queuedKeys(): Promise<string[]> {
  const rows = await db.select({ key: storageDeletion.objectKey }).from(storageDeletion);
  return rows.map((row) => row.key).sort();
}
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
});
