import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cut, jobStep, processingJob, render, storageDeletion, take, transcript } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { finish, markRunning, startJob, startTranscribeJob, updateStep } from "./jobs";
import { getTranscriptByTake, upsertTranscript } from "./transcripts";

/** Spec 0007, "Job model seam": a transcribe job works beside the take and never moves it. */
const SECRET = "test-usage-hash-secret-0123456789abcdef";

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

const words = [
  { w: "Hello", startMs: 100, endMs: 400, conf: 0.99, filler: false, para: true },
  { w: "um", startMs: 500, endMs: 700, conf: 0.9, filler: true, para: false },
];

describe("startTranscribeJob", () => {
  it("queues a transcribe job with one transcript step, charges 0 and leaves the take ready", async () => {
    const t = await readyTake();
    const job = await started(t.id);

    expect(job).toMatchObject({
      takeId: t.id,
      kind: "transcribe",
      status: "queued",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
      refunded: false,
    });
    expect(job.steps.map((s) => [s.name, s.status, s.position])).toEqual([
      ["transcript", "pending", 0],
    ]);
    const [after] = await db.select().from(take).where(eq(take.id, t.id));
    expect(after?.status).toBe("ready");
  });

  it("refuses when the transcript already exists (already_done)", async () => {
    const t = await readyTake();
    expect(
      (
        await upsertTranscript(db, {
          takeId: t.id,
          language: "en",
          text: "Hello",
          words,
          sourceFps: 30,
          model: "nova-3",
        })
      ).ok,
    ).toBe(true);
    expect(await startTranscribeJob(db, { takeId: t.id })).toEqual({
      ok: false,
      error: "already_done",
    });
    expect(
      await db.select().from(processingJob).where(eq(processingJob.takeId, t.id)),
    ).toHaveLength(0);
  });

  it("refuses when the original is gone: an expired take, or an expiry time that has passed (original_gone)", async () => {
    const expired = await readyTake({ status: "expired" });
    expect(await startTranscribeJob(db, { takeId: expired.id })).toEqual({
      ok: false,
      error: "original_gone",
    });
    const past = await readyTake({ videoExpiresAt: new Date(Date.now() - 1000) });
    expect(await startTranscribeJob(db, { takeId: past.id })).toEqual({
      ok: false,
      error: "original_gone",
    });
    const forever = await readyTake({ videoExpiresAt: null });
    expect((await startTranscribeJob(db, { takeId: forever.id })).ok).toBe(true);
  });

  it("refuses while any job of the take is active (job_active), a second transcribe included", async () => {
    const t = await readyTake();
    await started(t.id);
    expect(await startTranscribeJob(db, { takeId: t.id })).toEqual({
      ok: false,
      error: "job_active",
    });

    // A video job started through startJob is also an active job for the take.
    const other = await readyTake();
    const creatorId = other.creatorId;
    const initial = await startJob(db, { creatorId, takeId: other.id, usageSecret: SECRET });
    expect(initial.ok).toBe(true);
    expect(await startTranscribeJob(db, { takeId: other.id })).toMatchObject({ ok: false });
  });

  it("refuses a take that is not ready, an unknown take and a malformed ID", async () => {
    const creator = await createCreator(db);
    const uploaded = await seedTake(db, creator.id, { status: "uploaded" });
    expect(await startTranscribeJob(db, { takeId: uploaded.id })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(await startTranscribeJob(db, { takeId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await startTranscribeJob(db, { takeId: "not-a-uuid" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("lets a later transcribe job start once the failed one has finished (Try again)", async () => {
    const t = await readyTake();
    const first = await started(t.id);
    await finish(db, { jobId: first.id, status: "failed", failureCode: "provider_error" });
    const second = await startTranscribeJob(db, { takeId: t.id });
    expect(second.ok).toBe(true);
  });
});

describe("finish for a transcribe job", () => {
  it("never transitions the take, whatever the outcome", async () => {
    for (const outcome of ["succeeded", "failed"] as const) {
      const t = await readyTake();
      const job = await started(t.id);
      await markRunning(db, { jobId: job.id, triggerRunId: "run_t" });
      const result =
        outcome === "succeeded"
          ? await finish(db, { jobId: job.id, status: "succeeded" })
          : await finish(db, { jobId: job.id, status: "failed", failureCode: "provider_rejected" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.take.status).toBe("ready");
      expect(result.data.queuedKeys).toEqual([]);
      const [row] = await db.select().from(take).where(eq(take.id, t.id));
      expect(row?.status).toBe("ready");
      expect(row?.failureCode).toBeNull();
      const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
      expect(j).toMatchObject({
        status: outcome,
        failureCode: outcome === "failed" ? "provider_rejected" : null,
      });
    }
  });

  it("never refunds, even for a refundable code on a job that somehow carries a charge", async () => {
    const t = await readyTake();
    const job = await started(t.id);
    await db
      .update(processingJob)
      .set({ secondsCharged: 90, chargedMonth: "2026-11-01", chargedAccountHash: "h" })
      .where(eq(processingJob.id, job.id));
    const result = await finish(db, {
      jobId: job.id,
      status: "failed",
      failureCode: "provider_error",
    });
    expect(result.ok && result.data.refundedSeconds).toBe(0);
    const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(j?.refunded).toBe(false);
  });

  it("leaves the take's renders and cuts alone: the latest render keeps its video, no deletion is queued", async () => {
    const t = await readyTake();
    const videoJob = await db
      .insert(processingJob)
      .values({
        id: crypto.randomUUID(),
        takeId: t.id,
        kind: "initial",
        status: "succeeded",
        secondsCharged: 0,
      })
      .returning();
    const renderId = crypto.randomUUID();
    await db.insert(render).values({
      id: renderId,
      takeId: t.id,
      jobId: videoJob[0]!.id,
      status: "succeeded",
      videoKey: `renders/${t.id}/${renderId}.mp4`,
      durationMs: 5000,
      removedRanges: [],
      isLatest: true,
    });
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "pause",
      proposedBy: "rules",
      startMs: 1000,
      endMs: 2000,
      applied: true,
      reason: "Pause",
    });
    const keysBefore = (await db.select().from(storageDeletion)).length;

    const job = await started(t.id);
    await finish(db, { jobId: job.id, status: "failed", failureCode: "timeout" });

    const [r] = await db.select().from(render).where(eq(render.id, renderId));
    expect(r).toMatchObject({
      isLatest: true,
      status: "succeeded",
      videoKey: `renders/${t.id}/${renderId}.mp4`,
    });
    expect((await db.select().from(storageDeletion)).length).toBe(keysBefore);
    expect(await db.select().from(cut).where(eq(cut.takeId, t.id))).toHaveLength(1);
  });

  it("is idempotent: finishing twice answers already_final", async () => {
    const t = await readyTake();
    const job = await started(t.id);
    expect((await finish(db, { jobId: job.id, status: "succeeded" })).ok).toBe(true);
    expect(await finish(db, { jobId: job.id, status: "succeeded" })).toEqual({
      ok: false,
      error: "already_final",
    });
  });
});

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
