import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cut, jobStep, processingJob, render, storageDeletion, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { addManual } from "../cuts";
import { finish, markRunning, start } from "../jobs";
import { completeLatest, create as createRender } from "../renders";
import { type AfterDelete, deleteTake } from ".";

const SECRET = "test-usage-hash-secret-0123456789abcdef";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

/** Records the post commit side effects instead of calling Trigger.dev. */
function spyAfter() {
  const calls = { cancelled: [] as string[], drains: 0 };
  const after: AfterDelete = {
    cancelRuns: async (ids) => void calls.cancelled.push(...ids),
    requestStorageDrain: async () => void calls.drains++,
  };
  return { calls, after };
}

/** A take with cuts, one finished render run, and a second job still running. */
async function richTake(creatorId: string) {
  const t = await seedTake(db, creatorId, { durationMs: 10_000 });
  await addManual(db, { creatorId, takeId: t.id, startMs: 0, endMs: 500 });

  const first = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!first.ok) throw new Error(first.error);
  const r = await createRender(db, { takeId: t.id, jobId: first.data.id });
  if (!r.ok) throw new Error(r.error);
  const done = await completeLatest(db, { renderId: r.data.id, durationMs: 9_500 });
  if (!done.ok) throw new Error(done.error);
  await finish(db, { jobId: first.data.id, status: "succeeded" });

  const second = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!second.ok) throw new Error(second.error);
  await markRunning(db, { jobId: second.data.id, triggerRunId: `run_${t.id}` });
  return { take: t, renderKey: done.data.videoKey ?? "", jobIds: [first.data.id, second.data.id] };
}

describe("deleteTake (AC-17)", () => {
  it("removes every row of the take, queues its original and render keys, and cancels its run", async () => {
    const creator = await createCreator(db);
    const { take: t, renderKey, jobIds } = await richTake(creator.id);
    const { calls, after } = spyAfter();

    const result = await deleteTake(db, creator.id, t.id, after);

    expect(result.ok && [...result.data.queuedKeys].sort()).toEqual(
      [t.originalKey, `originals/${t.id}/thumb.jpg`, renderKey].sort(),
    );
    expect(result.ok && result.data.runIds).toEqual([`run_${t.id}`]);
    expect(calls).toEqual({ cancelled: [`run_${t.id}`], drains: 1 });

    expect(await db.select().from(take).where(eq(take.id, t.id))).toEqual([]);
    expect(await db.select().from(processingJob).where(eq(processingJob.takeId, t.id))).toEqual([]);
    expect(await db.select().from(jobStep).where(inArray(jobStep.jobId, jobIds))).toEqual([]);
    expect(await db.select().from(cut).where(eq(cut.takeId, t.id))).toEqual([]);
    expect(await db.select().from(render).where(eq(render.takeId, t.id))).toEqual([]);
    const queued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(
        inArray(storageDeletion.objectKey, [
          t.originalKey,
          `originals/${t.id}/thumb.jpg`,
          renderKey,
        ]),
      );
    expect(queued).toHaveLength(3);
  });

  it("queues the derived key of a render still in progress (its file may already be uploaded)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET });
    if (!job.ok) throw new Error(job.error);
    const pending = await createRender(db, { takeId: t.id, jobId: job.data.id });
    if (!pending.ok) throw new Error(pending.error);
    expect(pending.data.videoKey).toBeNull();

    const result = await deleteTake(db, creator.id, t.id, spyAfter().after);
    expect(result.ok && [...result.data.queuedKeys].sort()).toEqual(
      [
        t.originalKey,
        `originals/${t.id}/thumb.jpg`,
        `renders/${t.id}/${pending.data.id}.mp4`,
      ].sort(),
    );
  });

  it("gives another creator not_found and changes nothing", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    const t = await seedTake(db, a.id);
    const { calls, after } = spyAfter();

    expect(await deleteTake(db, b.id, t.id, after)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteTake(db, b.id, "nope", after)).toEqual({ ok: false, error: "not_found" });
    expect(calls).toEqual({ cancelled: [], drains: 0 });
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toHaveLength(1);
  });
});
