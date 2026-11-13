import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { whileJobActive } from "@/db/data/jobs";
import { queueDeletions } from "@/db/data/jobs/render-files";
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
} from "@/db/schema";
import { previewKey } from "@/lib/background-preview";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { thumbnailKey } from "@/lib/take-rules";
import { ok } from "@/lib/result";
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
      [t.originalKey, renderKey, thumbnailKey(t.id)].sort(),
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
      .where(inArray(storageDeletion.objectKey, [t.originalKey, renderKey]));
    expect(queued).toHaveLength(2);
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
      [t.originalKey, `renders/${t.id}/${pending.data.id}.mp4`, thumbnailKey(t.id)].sort(),
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

describe("deleteTake removes everything (spec 0013 AC-6)", () => {
  it("removes the transcript with its edits and the previews, and queues the preview stills", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { durationMs: 10_000 });
    const saved = await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "hello there",
      words: [{ text: "hello", startMs: 0, endMs: 400 }] as never,
      sourceFps: 30,
      model: "test",
    });
    if (!saved.ok) throw new Error(saved.error);
    await setTranscriptEdits(db, t.id, [
      { index: 0, old: "hello", new: "Hello", reason: "case", undone: false },
    ]);
    const bgId = crypto.randomUUID();
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
      takeId: t.id,
      backgroundId: bgId,
      cutVersion: "v",
      status: "ready",
      objectKey: previewKey(t.id, previewId),
    });

    const result = await deleteTake(db, creator.id, t.id, spyAfter().after);

    expect(result.ok && result.data.queuedKeys).toContain(previewKey(t.id, previewId));
    expect(await db.select().from(transcript).where(eq(transcript.takeId, t.id))).toEqual([]);
    expect(
      await db.select().from(backgroundPreview).where(eq(backgroundPreview.takeId, t.id)),
    ).toEqual([]);
    const queued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(eq(storageDeletion.objectKey, previewKey(t.id, previewId)));
    expect(queued).toHaveLength(1);
    // The background is shared and stays.
    expect(
      await db.select({ id: background.id }).from(background).where(eq(background.id, bgId)),
    ).toHaveLength(1);
  });

  it("still returns ok with the rows gone when the cancel and the drain request both fail", async () => {
    const creator = await createCreator(db);
    const { take: t } = await richTake(creator.id);
    const after: AfterDelete = {
      cancelRuns: async () => {
        throw new Error("trigger down");
      },
      requestStorageDrain: async () => {
        throw new Error("trigger down");
      },
    };
    const result = await deleteTake(db, creator.id, t.id, after);
    expect(result.ok).toBe(true);
    expect(await db.select().from(take).where(eq(take.id, t.id))).toEqual([]);
    const queued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(eq(storageDeletion.objectKey, t.originalKey));
    expect(queued).toHaveLength(1);
  });

  it("leaves nothing behind when the take is deleted during a running job (AC-7)", async () => {
    const creator = await createCreator(db);
    const { take: t, jobIds } = await richTake(creator.id);
    const runningJob = jobIds[1]!;

    await deleteTake(db, creator.id, t.id, spyAfter().after);

    // The job's late write is fenced: the job row is gone, so it must not write.
    let wrote = false;
    const late = await whileJobActive(db, runningJob, async () => {
      wrote = true;
      return ok(null);
    });
    expect(late).toEqual({ ok: false, error: "job_final" });
    expect(wrote).toBe(false);

    // The late upload queues its own key and the file is then drained like any other.
    const lateKey = `renders/${t.id}/${crypto.randomUUID()}.mp4`;
    await queueDeletions(db, [lateKey]);
    const queued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(eq(storageDeletion.objectKey, lateKey));
    expect(queued).toHaveLength(1);
    expect(await db.select().from(processingJob).where(eq(processingJob.takeId, t.id))).toEqual([]);
    expect(await db.select().from(render).where(eq(render.takeId, t.id))).toEqual([]);
  });
});
