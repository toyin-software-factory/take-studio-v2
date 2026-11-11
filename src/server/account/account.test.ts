import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingJob, render, storageDeletion, take, user } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { finish, markRunning, start } from "../jobs";
import { completeLatest, create as createRender } from "../renders";
import type { AfterDelete } from "../takes";
import { deleteCreatorData } from ".";

const SECRET = "test-usage-hash-secret-0123456789abcdef";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

async function renderedTake(creatorId: string) {
  const t = await seedTake(db, creatorId);
  const job = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  const r = await createRender(db, { takeId: t.id, jobId: job.data.id });
  if (!r.ok) throw new Error(r.error);
  const done = await completeLatest(db, { renderId: r.data.id, durationMs: 5_000 });
  if (!done.ok) throw new Error(done.error);
  await finish(db, { jobId: job.data.id, status: "succeeded" });
  return { take: t, renderKey: done.data.videoKey ?? "" };
}

describe("account deletion (AC-17)", () => {
  it("removes everything of the creator, queues all their files and cancels their runs; others are untouched", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const one = await renderedTake(creator.id);
    const two = await seedTake(db, creator.id);
    const running = await start(db, { creatorId: creator.id, takeId: two.id, usageSecret: SECRET });
    if (!running.ok) throw new Error(running.error);
    await markRunning(db, { jobId: running.data.id, triggerRunId: "run_account" });
    const keep = await seedTake(db, other.id);

    const calls = { cancelled: [] as string[], drains: 0 };
    const after: AfterDelete = {
      cancelRuns: async (ids) => void calls.cancelled.push(...ids),
      requestStorageDrain: async () => void calls.drains++,
    };

    // What Better Auth's deleteUser does: our beforeDelete hook, then the user row.
    const deleted = await deleteCreatorData(db, creator.id, after);
    await db.delete(user).where(eq(user.id, creator.id));

    expect([...deleted.queuedKeys].sort()).toEqual(
      [one.take.originalKey, one.renderKey, two.originalKey].sort(),
    );
    expect(calls).toEqual({ cancelled: ["run_account"], drains: 1 });

    // Nothing of the creator remains, including the jobs that held charge hashes.
    expect(await db.select().from(user).where(eq(user.id, creator.id))).toEqual([]);
    expect(await db.select().from(take).where(eq(take.creatorId, creator.id))).toEqual([]);
    expect(
      await db
        .select()
        .from(processingJob)
        .where(inArray(processingJob.takeId, [one.take.id, two.id])),
    ).toEqual([]);
    expect(await db.select().from(render).where(eq(render.takeId, one.take.id))).toEqual([]);
    const queued = await db
      .select()
      .from(storageDeletion)
      .where(inArray(storageDeletion.objectKey, [...deleted.queuedKeys]));
    expect(queued).toHaveLength(3);

    // The other creator's take survives.
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, keep.id))).toHaveLength(1);
  });

  it("is a no op for a creator with no takes", async () => {
    const creator = await createCreator(db);
    const calls = { cancelled: [] as string[], drains: 0 };
    const deleted = await deleteCreatorData(db, creator.id, {
      cancelRuns: async (ids) => void calls.cancelled.push(...ids),
      requestStorageDrain: async () => void calls.drains++,
    });
    expect(deleted).toEqual({ queuedKeys: [], runIds: [] });
    expect(calls).toEqual({ cancelled: [], drains: 0 });
  });
});
