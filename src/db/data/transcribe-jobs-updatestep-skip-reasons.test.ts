import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobStep, take, transcript } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { markRunning, startTranscribeJob, updateStep } from "./jobs";
import { getTranscriptByTake, upsertTranscript } from "./transcripts";
import { words } from "./transcribe-jobs-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
async function readyTake(overrides: Partial<typeof take.$inferInsert> = {}) {
  const creator = await createCreator(db);
  return seedTake(db, creator.id, { status: "ready", ...overrides });
}
async function started(takeId: string) {
  const result = await startTranscribeJob(db, { takeId });
  if (!result.ok) throw new Error(`start refused: ${result.error}`);
  return result.data;
}
describe("updateStep skip reasons and failure codes (spec 0007)", () => {
  async function runningStep() {
    const t = await readyTake();
    const job = await started(t.id);
    await markRunning(db, { jobId: job.id, triggerRunId: "run_s" });
    return job.id;
  }

  it("accepts a skip reason with skipped and stores it", async () => {
    const jobId = await runningStep();
    const result = await updateStep(db, {
      jobId,
      name: "transcript",
      status: "skipped",
      progress: 0,
      failureCode: "not_english",
    });
    expect(result.ok && result.data).toMatchObject({
      status: "skipped",
      failureCode: "not_english",
    });
  });

  it("rejects a skip reason on a failed step, and a failure code on a skipped step", async () => {
    const jobId = await runningStep();
    expect(
      await updateStep(db, {
        jobId,
        name: "transcript",
        status: "failed",
        progress: 0,
        failureCode: "no_speech",
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      await updateStep(db, {
        jobId,
        name: "transcript",
        status: "skipped",
        progress: 0,
        failureCode: "provider_error",
      }),
    ).toEqual({ ok: false, error: "invalid" });
    const [step] = await db.select().from(jobStep).where(eq(jobStep.jobId, jobId));
    expect(step).toMatchObject({ status: "pending", failureCode: null });
  });

  it("accepts a failure code with failed, and rejects any code on other statuses or unknown ones", async () => {
    const jobId = await runningStep();
    expect(
      await updateStep(db, {
        jobId,
        name: "transcript",
        status: "running",
        progress: 40,
        failureCode: "no_speech",
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      await updateStep(db, {
        jobId,
        name: "transcript",
        status: "skipped",
        progress: 0,
        failureCode: "made_up" as never,
      }),
    ).toEqual({ ok: false, error: "invalid" });
    const failed = await updateStep(db, {
      jobId,
      name: "transcript",
      status: "failed",
      progress: 0,
      failureCode: "provider_rejected",
    });
    expect(failed.ok && failed.data).toMatchObject({
      status: "failed",
      failureCode: "provider_rejected",
    });
  });
});
describe("transcript data functions", () => {
  it("returns null before a transcript exists, then the stored row", async () => {
    const t = await readyTake();
    expect(await getTranscriptByTake(db, t.id)).toBeNull();
    const saved = await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "Hello um",
      words,
      sourceFps: 29.97,
      model: "nova-3",
    });
    expect(saved.ok).toBe(true);
    const row = await getTranscriptByTake(db, t.id);
    expect(row).toMatchObject({
      takeId: t.id,
      language: "en",
      text: "Hello um",
      sourceFps: 29.97,
      model: "nova-3",
    });
    expect(row?.words).toEqual(words);
  });

  it("overwrites on a repeat run: one row per take, new text, updated_at moves", async () => {
    const t = await readyTake();
    const first = await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "one",
      words,
      sourceFps: 30,
      model: "nova-3",
    });
    await new Promise((r) => setTimeout(r, 15));
    const second = await upsertTranscript(db, {
      takeId: t.id,
      language: "en-GB",
      text: "two",
      words: [words[0]!],
      sourceFps: 25,
      model: "nova-3",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.id).toBe(first.data.id);
    expect(second.data).toMatchObject({ text: "two", language: "en-GB", sourceFps: 25 });
    expect(second.data.updatedAt.getTime()).toBeGreaterThan(first.data.updatedAt.getTime());
    expect(await db.select().from(transcript).where(eq(transcript.takeId, t.id))).toHaveLength(1);
  });

  it("answers take_gone when the take was deleted, and deletes the transcript with the take", async () => {
    expect(
      await upsertTranscript(db, {
        takeId: crypto.randomUUID(),
        language: "en",
        text: "x",
        words,
        sourceFps: 30,
        model: "nova-3",
      }),
    ).toEqual({ ok: false, error: "take_gone" });
    const t = await readyTake();
    await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "x",
      words,
      sourceFps: 30,
      model: "nova-3",
    });
    await db.delete(take).where(eq(take.id, t.id));
    expect(await getTranscriptByTake(db, t.id)).toBeNull();
  });
});
