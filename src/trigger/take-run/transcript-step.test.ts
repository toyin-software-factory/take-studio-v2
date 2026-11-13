import { writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { JobDb } from "@/db/client/job";
import { jobStep, processingJob, transcript } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { RunContext } from "./context";

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AbortTaskRunError: class extends Error {},
}));

import { DeepgramError, DeepgramRejected, DeepgramTimeout } from "../transcript-provider";
import { type TranscriptStepIo, transcriptStep } from "./transcript-step";

/** Spec 0012 task 1: the in run `transcript` step (AC-1, AC-6, AC-7). */
let testDb: TestDb;
let db: JobDb;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db as unknown as JobDb;
});
afterAll(() => testDb?.close());

const SECRET_TEXT = "secret words spoken";
const body = (language = "en-GB", words = true) => ({
  results: {
    channels: [
      {
        detected_language: language,
        alternatives: [
          {
            transcript: SECRET_TEXT,
            words: words
              ? [
                  { word: "secret", punctuated_word: "Secret", start: 0, end: 0.5, confidence: 1 },
                  { word: "words", punctuated_word: "words", start: 0.6, end: 1, confidence: 1 },
                ]
              : [],
            paragraphs: { paragraphs: [{ start: 0 }] },
          },
        ],
      },
    ],
  },
});

const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function seedRun(options: { hasAudio?: boolean; jobStatus?: "running" | "cancelled" } = {}) {
  const creator = await createCreator(testDb.db);
  const t = await seedTake(testDb.db, creator.id, { status: "processing" });
  const [job] = await testDb.db
    .insert(processingJob)
    .values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "initial",
      status: options.jobStatus ?? "running",
      secondsCharged: 2,
    })
    .returning();
  if (!job) throw new Error("no job");
  for (const [position, name] of (["trim", "transcript", "render"] as const).entries()) {
    await testDb.db.insert(jobStep).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      name,
      position,
      status: "pending",
    });
  }
  const work = await mkdtemp(join(tmpdir(), "transcript-step-"));
  dirs.push(work);
  const ctx = {
    client: db,
    signal: new AbortController().signal,
    job,
    take: t,
    work,
    source: join(work, "source.mp4"),
    facts: { hasAudio: options.hasAudio ?? true, fps: 29.97, durationMs: 10_000 },
  } as unknown as RunContext;
  return { ctx, take: t, job };
}

function io(over: Partial<TranscriptStepIo> = {}) {
  const post = vi.fn(async () => body());
  const extractAudio = vi.fn(async (_source: string, out: string) => {
    await writeFile(out, "ogg");
  });
  const value: TranscriptStepIo = {
    apiKey: () => "key",
    extractAudio,
    post,
    pause: async () => {},
    ...over,
  };
  return { value, post, extractAudio };
}

const stepOf = async (jobId: string) => {
  const rows = await db.select().from(jobStep).where(eq(jobStep.jobId, jobId));
  const found = rows.find((r) => r.name === "transcript");
  return { status: found?.status, code: found?.failureCode };
};
const transcripts = (takeId: string) =>
  db.select().from(transcript).where(eq(transcript.takeId, takeId));
const run = (ctx: RunContext, value: TranscriptStepIo, signal = ctx.signal) =>
  transcriptStep(ctx, signal, value);

describe("transcriptStep", () => {
  it("makes the transcript from the local original and saves it (AC-1)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, post, extractAudio } = io();
    expect(await run(ctx, value)).toBe("succeeded");
    expect(extractAudio).toHaveBeenCalledWith(ctx.source, join(ctx.work, "audio.ogg"), ctx.signal);
    expect(post).toHaveBeenCalledTimes(1);
    expect(await stepOf(job.id)).toEqual({ status: "succeeded", code: null });
    const rows = await transcripts(take.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceFps).toBe(29.97);
  });

  it("skips a take with no sound as no_speech without calling Deepgram", async () => {
    const { ctx, job, take } = await seedRun({ hasAudio: false });
    const { value, post, extractAudio } = io();
    expect(await run(ctx, value)).toBe("skipped");
    expect(post).not.toHaveBeenCalled();
    expect(extractAudio).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "no_speech" });
    expect(await transcripts(take.id)).toHaveLength(0);
  });

  it.each([
    ["not_english", () => body("fr")],
    ["no_speech", () => body("en", false)],
  ])("skips %s without saving", async (reason, answer) => {
    const { ctx, job, take } = await seedRun();
    const { value } = io({ post: async () => answer() });
    expect(await run(ctx, value)).toBe("skipped");
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: reason });
    expect(await transcripts(take.id)).toHaveLength(0);
  });

  it("a missing Deepgram key fails only the step (provider_error)", async () => {
    const { ctx, job } = await seedRun();
    const { value, post } = io({ apiKey: () => null });
    expect(await run(ctx, value)).toBe("failed");
    expect(post).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "failed", code: "provider_error" });
    const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(j?.status).toBe("running");
  });

  it("retries once on a 5xx and then succeeds (AC-7)", async () => {
    const { ctx, job } = await seedRun();
    const post = vi
      .fn<TranscriptStepIo["post"]>()
      .mockRejectedValueOnce(new DeepgramError(503))
      .mockResolvedValue(body());
    expect(await run(ctx, io({ post }).value)).toBe("succeeded");
    expect(post).toHaveBeenCalledTimes(2);
    expect((await stepOf(job.id)).status).toBe("succeeded");
  });

  it("fails the step after the one retry, and the caller starts the separate job (AC-7)", async () => {
    const { ctx, job, take } = await seedRun();
    const post = vi.fn(async () => {
      throw new DeepgramError(500);
    });
    expect(await run(ctx, io({ post }).value)).toBe("failed");
    expect(post).toHaveBeenCalledTimes(2);
    expect(await stepOf(job.id)).toEqual({ status: "failed", code: "provider_error" });
    expect(await transcripts(take.id)).toHaveLength(0);
  });

  it("does not retry a rejected request or a timeout", async () => {
    const rejected = await seedRun();
    const postRejected = vi.fn(async () => {
      throw new DeepgramRejected(402);
    });
    expect(await run(rejected.ctx, io({ post: postRejected }).value)).toBe("failed");
    expect(postRejected).toHaveBeenCalledTimes(1);
    expect(await stepOf(rejected.job.id)).toEqual({ status: "failed", code: "provider_rejected" });

    const slow = await seedRun();
    const postSlow = vi.fn(async () => {
      throw new DeepgramTimeout();
    });
    expect(await run(slow.ctx, io({ post: postSlow }).value)).toBe("failed");
    expect(postSlow).toHaveBeenCalledTimes(1);
    expect(await stepOf(slow.job.id)).toEqual({ status: "failed", code: "timeout" });
  });

  it("the edit deadline stops the step: failed timeout, the job goes on (AC-6)", async () => {
    const { ctx, job } = await seedRun();
    const edit = new AbortController();
    const post = vi.fn(
      (_audio: Uint8Array, _key: string, signal: AbortSignal) =>
        new Promise<unknown>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const running = run(ctx, io({ post }).value, edit.signal);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    edit.abort(new Error("edit deadline"));
    expect(await running).toBe("failed");
    expect(await stepOf(job.id)).toEqual({ status: "failed", code: "timeout" });
    const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(j?.status).toBe("running");
  });

  it("rethrows when the run itself was stopped", async () => {
    const { ctx } = await seedRun();
    const stop = new AbortController();
    const stopped = { ...ctx, signal: stop.signal } as RunContext;
    const post = vi.fn(async () => {
      stop.abort(new Error("run stopped"));
      throw new DeepgramError(null);
    });
    await expect(run(stopped, io({ post }).value, stop.signal)).rejects.toThrow("run stopped");
  });

  it("reuses a finished step on a retry of the job: Deepgram is not called again", async () => {
    const { ctx, job, take } = await seedRun();
    expect(await run(ctx, io().value)).toBe("succeeded");
    const again = io();
    expect(await run(ctx, again.value)).toBe("succeeded");
    expect(again.post).not.toHaveBeenCalled();
    expect(again.extractAudio).not.toHaveBeenCalled();
    expect(await transcripts(take.id)).toHaveLength(1);
    expect((await stepOf(job.id)).status).toBe("succeeded");

    const failed = await seedRun();
    const post = vi.fn(async () => {
      throw new DeepgramRejected(400);
    });
    expect(await run(failed.ctx, io({ post }).value)).toBe("failed");
    const retry = io();
    expect(await run(failed.ctx, retry.value)).toBe("failed");
    expect(retry.post).not.toHaveBeenCalled();
  });

  it("writes nothing and stops when the job was cancelled meanwhile", async () => {
    const { ctx, take } = await seedRun({ jobStatus: "cancelled" });
    await expect(run(ctx, io().value)).rejects.toThrow();
    expect(await transcripts(take.id)).toHaveLength(0);
  });
});
