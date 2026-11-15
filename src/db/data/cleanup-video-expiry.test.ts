import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { thumbnailKey } from "@/lib/take-rules";
import { cut, processingJob, render, storageDeletion, take, transcript } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { expireDueTakes } from "./cleanup";
import { expireTake } from "./deletion";
import { NOW, minutes } from "./cleanup-test-helpers";

/**
 * These sweep whole tables, so they use their own database and start each test empty.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup_3" });
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

  it("expires only after the date, and the transcript with its edits stays (spec 0013, AC-8)", async () => {
    const creator = await createCreator(db);
    const justBefore = await seedTake(db, creator.id, {
      status: "ready",
      videoExpiresAt: new Date(NOW.getTime() + 1000),
    });
    const due = await seedTake(db, creator.id, { status: "ready", videoExpiresAt: minutes(1) });
    await db.insert(transcript).values({
      id: crypto.randomUUID(),
      takeId: due.id,
      language: "en",
      text: "kept words",
      words: [],
      sourceFps: 30,
      model: "test",
      edits: [{ index: 0, old: "a", new: "b", reason: "r", undone: false }],
    });

    await expireDueTakes(db, NOW);

    const rows = await db
      .select({ id: take.id, status: take.status })
      .from(take)
      .where(inArray(take.id, [justBefore.id, due.id]));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [justBefore.id]: "ready",
      [due.id]: "expired",
    });
    const [kept] = await db.select().from(transcript).where(eq(transcript.takeId, due.id));
    expect(kept).toMatchObject({ text: "kept words", edits: [{ index: 0, new: "b" }] });
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
