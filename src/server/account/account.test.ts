import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTranscriptEdits, upsertTranscript } from "@/db/data/transcripts";
import {
  background,
  backgroundPreview,
  cut,
  jobStep,
  processingJob,
  render,
  storageDeletion,
  take,
  transcript,
  user,
} from "@/db/schema";
import { previewKey } from "@/lib/background-preview";
import {
  type TestDb,
  createCreator,
  openTestDb,
  seedTake,
  builtInTracker,
} from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { backgroundKeys } from "@/lib/background-rules";
import { thumbnailKey } from "@/lib/take-rules";
import { addManual } from "../cuts";
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
const built = builtInTracker();
afterAll(async () => {
  if (testDb) await built.clean(testDb.db);
  await testDb?.close();
});

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
      [
        one.take.originalKey,
        one.renderKey,
        two.originalKey,
        thumbnailKey(one.take.id),
        thumbnailKey(two.id),
      ].sort(),
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
    expect(queued).toHaveLength(5);

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

describe("account deletion and uploaded backgrounds (spec 0008, AC-10)", () => {
  it("deletes the creator's backgrounds and queues all their files, leaving other creators' alone", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const mine = [crypto.randomUUID(), crypto.randomUUID()];
    const theirs = crypto.randomUUID();
    const row = (id: string, creatorId: string, status: string) => ({
      id,
      creatorId,
      name: "Wall",
      status,
      ...(status === "ready"
        ? {
            imageKey: backgroundKeys(creatorId, id).imageKey,
            thumbKey: backgroundKeys(creatorId, id).thumbKey,
            width: 1920,
            height: 1080,
          }
        : {}),
    });
    await db
      .insert(background)
      .values([
        row(mine[0]!, creator.id, "ready"),
        row(mine[1]!, creator.id, "processing"),
        row(theirs, other.id, "ready"),
      ]);
    const calls = { drains: 0 };
    await deleteCreatorData(db, creator.id, {
      cancelRuns: async () => 0,
      requestStorageDrain: async () => void calls.drains++,
    });
    expect(calls.drains).toBe(1);
    expect(
      await db.select().from(background).where(eq(background.creatorId, creator.id)),
    ).toHaveLength(0);
    expect(await db.select().from(background).where(eq(background.id, theirs))).toHaveLength(1);
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    for (const id of mine) {
      const keys = backgroundKeys(creator.id, id);
      expect(queued).toEqual(
        expect.arrayContaining([keys.sourceKey, keys.imageKey, keys.thumbKey]),
      );
    }
    expect(queued).not.toContain(backgroundKeys(other.id, theirs).imageKey);
  });
});

describe("account deletion with a take of every kind (spec 0013, AC-10)", () => {
  it("leaves no row of the creator and queues every file, whatever state each take is in", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const bystander = await seedTake(db, other.id);

    // Rendered take with cuts, a transcript with AI edits, and a background preview.
    const rendered = await renderedTake(creator.id);
    await addManual(db, {
      creatorId: creator.id,
      takeId: rendered.take.id,
      startMs: 0,
      endMs: 400,
    });
    const saved = await upsertTranscript(db, {
      takeId: rendered.take.id,
      language: "en",
      text: "hello",
      words: [{ text: "hello", startMs: 0, endMs: 400 }] as never,
      sourceFps: 30,
      model: "test",
    });
    if (!saved.ok) throw new Error(saved.error);
    await setTranscriptEdits(db, rendered.take.id, [
      { index: 0, old: "hello", new: "Hello", reason: "case", undone: false },
    ]);
    const bgId = built.track({ id: crypto.randomUUID() }).id;
    await db.insert(background).values({
      id: bgId,
      creatorId: null,
      name: "Studio",
      imageKey: `backgrounds/builtin/${bgId}.jpg`,
      thumbKey: `backgrounds/builtin/${bgId}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
    });
    const previewId = crypto.randomUUID();
    await db.insert(backgroundPreview).values({
      id: previewId,
      takeId: rendered.take.id,
      backgroundId: bgId,
      cutVersion: "v",
      status: "ready",
      objectKey: previewKey(rendered.take.id, previewId),
    });

    // A take with a job still running, an expired take, and a failed take.
    const running = await seedTake(db, creator.id);
    const job = await start(db, { creatorId: creator.id, takeId: running.id, usageSecret: SECRET });
    if (!job.ok) throw new Error(job.error);
    await markRunning(db, { jobId: job.data.id, triggerRunId: "run_every_kind" });
    const expired = await seedTake(db, creator.id, { status: "expired" });
    const failed = await seedTake(db, creator.id, { status: "failed" });
    const takeIds = [rendered.take.id, running.id, expired.id, failed.id];

    // An uploaded background of the creator's own.
    const own = crypto.randomUUID();
    const ownKeys = backgroundKeys(creator.id, own);
    await db.insert(background).values({
      id: own,
      creatorId: creator.id,
      name: "Mine",
      sourceKey: ownKeys.sourceKey,
      imageKey: ownKeys.imageKey,
      thumbKey: ownKeys.thumbKey,
      width: 1920,
      height: 1080,
      status: "ready",
    });

    const calls = { cancelled: [] as string[], drains: 0 };
    const deleted = await deleteCreatorData(db, creator.id, {
      cancelRuns: async (ids) => void calls.cancelled.push(...ids),
      requestStorageDrain: async () => void calls.drains++,
    });
    await db.delete(user).where(eq(user.id, creator.id));

    expect(calls).toEqual({ cancelled: ["run_every_kind"], drains: 1 });
    for (const key of [
      rendered.take.originalKey,
      rendered.renderKey,
      thumbnailKey(rendered.take.id),
      previewKey(rendered.take.id, previewId),
      running.originalKey,
    ]) {
      expect(deleted.queuedKeys).toContain(key);
    }
    const queued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(inArray(storageDeletion.objectKey, [...deleted.queuedKeys]));
    expect(queued.length).toBe(new Set(deleted.queuedKeys).size);
    // The creator's own background files are queued by their own step.
    const ownQueued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(
        inArray(storageDeletion.objectKey, [ownKeys.sourceKey, ownKeys.imageKey, ownKeys.thumbKey]),
      );
    expect(ownQueued.length).toBe(3);

    // No row of the creator is left in any table.
    expect(await db.select().from(take).where(inArray(take.id, takeIds))).toEqual([]);
    expect(
      await db.select().from(processingJob).where(inArray(processingJob.takeId, takeIds)),
    ).toEqual([]);
    expect(await db.select().from(render).where(inArray(render.takeId, takeIds))).toEqual([]);
    expect(await db.select().from(cut).where(inArray(cut.takeId, takeIds))).toEqual([]);
    expect(await db.select().from(transcript).where(inArray(transcript.takeId, takeIds))).toEqual(
      [],
    );
    expect(
      await db.select().from(backgroundPreview).where(inArray(backgroundPreview.takeId, takeIds)),
    ).toEqual([]);
    expect(await db.select().from(jobStep).where(eq(jobStep.jobId, job.data.id))).toEqual([]);
    expect(await db.select().from(background).where(eq(background.creatorId, creator.id))).toEqual(
      [],
    );
    expect(await db.select().from(user).where(eq(user.id, creator.id))).toEqual([]);

    // The shared studio and the other creator's take stay.
    expect(
      await db.select({ id: background.id }).from(background).where(eq(background.id, bgId)),
    ).toHaveLength(1);
    expect(
      await db.select({ id: take.id }).from(take).where(eq(take.id, bystander.id)),
    ).toHaveLength(1);
  });
});
