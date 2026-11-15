import { writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import type { JobDb } from "@/db/client/job";
import { jobStep, processingJob, transcript } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { RunContext } from "./context";
import { type TranscriptStepIo, transcriptStep } from "./transcript-step";

/** Spec 0012 task 1: the in run `transcript` step (AC-1, AC-6, AC-7). */
export let testDb: TestDb;
export let db: JobDb;
export const dirs: string[] = [];

/** Opens the test database before the file's tests and clears mocks and temp folders after each. */
export function registerDb() {
  beforeAll(async () => {
    testDb = await openTestDb();
    db = testDb.db as unknown as JobDb;
  });
  afterAll(() => testDb?.close());
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
}

export const SECRET_TEXT = "secret words spoken";
export const body = (language = "en-GB", words = true) => ({
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

export async function seedRun(
  options: { hasAudio?: boolean; jobStatus?: "running" | "cancelled" } = {},
) {
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

export function io(over: Partial<TranscriptStepIo> = {}) {
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

export const stepOf = async (jobId: string) => {
  const rows = await db.select().from(jobStep).where(eq(jobStep.jobId, jobId));
  const found = rows.find((r) => r.name === "transcript");
  return { status: found?.status, code: found?.failureCode };
};
export const transcripts = (takeId: string) =>
  db.select().from(transcript).where(eq(transcript.takeId, takeId));
export const run = (ctx: RunContext, value: TranscriptStepIo, signal = ctx.signal) =>
  transcriptStep(ctx, signal, value);
