import { eq } from "drizzle-orm";
import { afterAll, beforeAll, vi } from "vitest";
import { startTranscribeJob } from "@/db/data/jobs";
import { jobStep, processingJob } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type TranscribeIo } from "./transcribe-take";

export let testDb: TestDb;
export let db: Db;

/** Opens the test database before the file's tests and closes it after. */
export function registerDb() {
  beforeAll(async () => {
    testDb = await openTestDb();
    db = testDb.db;
  });
  afterAll(() => testDb?.close());
}

export const SECRET_TEXT = "secret words spoken";
export const dgBody = (language = "en-GB", words = true) => ({
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

export async function job() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready" });
  const started = await startTranscribeJob(db, { takeId: t.id });
  if (!started.ok) throw new Error("start refused");
  return { take: t, jobId: started.data.id };
}

export function io(over: Partial<TranscribeIo> = {}) {
  const post = vi.fn(async () => dgBody());
  const value: TranscribeIo = {
    r2: {
      headObject: async () => ({ size: 1 }),
      presignGet: async () => "https://r2.test/x?sig=1",
    },
    probe: async () => ({ hasAudio: true, fps: 29.97 }) as never,
    extractAudio: async (_link, out) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(out, "ogg");
    },
    post,
    ...over,
  };
  return { value, post };
}

export async function outcome(jobId: string) {
  const [j] = await db.select().from(processingJob).where(eq(processingJob.id, jobId));
  const [s] = await db.select().from(jobStep).where(eq(jobStep.jobId, jobId));
  return { job: j, step: s };
}
