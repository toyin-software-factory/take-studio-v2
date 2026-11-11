import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, storageDeletion } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { addManual, setApplied } from "../cuts";
import { finish, start } from "../jobs";
import { completeLatest, create, getForCreator } from ".";

const SECRET = "test-usage-hash-secret-0123456789abcdef";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb.close());

async function startJob(creatorId: string, takeId: string) {
  const job = await start(db, { creatorId, takeId, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  return job.data;
}

/** One full run: start, create the render, complete it, finish the job. */
async function renderRun(creatorId: string, takeId: string) {
  const job = await startJob(creatorId, takeId);
  const created = await create(db, { takeId, jobId: job.id });
  if (!created.ok) throw new Error(created.error);
  const completed = await completeLatest(db, { renderId: created.data.id, durationMs: 9_000 });
  if (!completed.ok) throw new Error(completed.error);
  const finished = await finish(db, { jobId: job.id, status: "succeeded" });
  if (!finished.ok) throw new Error(finished.error);
  return { job, render: completed.data, finished: finished.data };
}

describe("renders.create (AC-9, AC-10)", () => {
  it("snapshots the applied cuts at render start; later changes don't touch the snapshot", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { durationMs: 10_000 });
    const kept = await addManual(db, {
      creatorId: creator.id,
      takeId: t.id,
      startMs: 4000,
      endMs: 5000,
    });
    const undone = await addManual(db, {
      creatorId: creator.id,
      takeId: t.id,
      startMs: 0,
      endMs: 1000,
    });
    if (!kept.ok || !undone.ok) throw new Error("seed cuts");
    await setApplied(db, { creatorId: creator.id, cutId: undone.data.id, applied: false });

    const job = await startJob(creator.id, t.id);
    const created = await create(db, { takeId: t.id, jobId: job.id });
    expect(created.ok && created.data).toMatchObject({
      status: "pending",
      videoKey: null,
      isLatest: false,
      removedRanges: [{ startMs: 4000, endMs: 5000 }],
    });

    await setApplied(db, { creatorId: creator.id, cutId: undone.data.id, applied: true });
    const [row] = await db
      .select()
      .from(render)
      .where(eq(render.id, created.ok ? created.data.id : ""));
    expect(row?.removedRanges).toEqual([{ startMs: 4000, endMs: 5000 }]);
  });

  it("refuses a job that belongs to another take", async () => {
    const creator = await createCreator(db);
    const t1 = await seedTake(db, creator.id);
    const t2 = await seedTake(db, creator.id);
    const job = await startJob(creator.id, t1.id);
    expect(await create(db, { takeId: t2.id, jobId: job.id })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("renders.completeLatest (AC-10)", () => {
  it("records success with the derived key, once", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await startJob(creator.id, t.id);
    const created = await create(db, { takeId: t.id, jobId: job.id });
    if (!created.ok) throw new Error(created.error);

    const done = await completeLatest(db, { renderId: created.data.id, durationMs: 9_000 });
    expect(done.ok && done.data).toMatchObject({
      status: "succeeded",
      durationMs: 9_000,
      videoKey: `renders/${t.id}/${created.data.id}.mp4`,
      isLatest: false, // jobs.finish makes it the latest
    });
    expect(await completeLatest(db, { renderId: created.data.id, durationMs: 9_000 })).toEqual({
      ok: false,
      error: "already_final",
    });
    expect(await completeLatest(db, { renderId: created.data.id, durationMs: 0 })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("with jobs.finish leaves exactly one latest render with a key and queues the old key", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const first = await renderRun(creator.id, t.id);
    const second = await renderRun(creator.id, t.id);

    const renders = await db.select().from(render).where(eq(render.takeId, t.id));
    const latest = renders.filter((r) => r.isLatest);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ id: second.render.id, videoKey: second.render.videoKey });
    expect(renders.find((r) => r.id === first.render.id)).toMatchObject({
      isLatest: false,
      videoKey: null,
    });
    expect(renders.filter((r) => r.videoKey !== null)).toHaveLength(1);

    const oldKey = first.render.videoKey ?? "";
    expect(second.finished.queuedKeys).toEqual([oldKey]);
    const queued = await db
      .select()
      .from(storageDeletion)
      .where(eq(storageDeletion.objectKey, oldKey));
    expect(queued).toHaveLength(1);
  });
});

describe("ownership (AC-2)", () => {
  it("gives creator B not_found on creator A's render", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    const t = await seedTake(db, a.id);
    const { render: own } = await renderRun(a.id, t.id);

    expect((await getForCreator(db, a.id, own.id)).ok).toBe(true);
    expect(await getForCreator(db, b.id, own.id)).toEqual({ ok: false, error: "not_found" });
    expect(await getForCreator(db, b.id, "x")).toEqual({ ok: false, error: "not_found" });
  });
});
