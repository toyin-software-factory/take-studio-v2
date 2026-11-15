import { eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";
import type { JobDb } from "@/db/client/job";
import { background, cut, jobStep, processingJob, transcript } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { AiCandidate, AiEditAnswer } from "@/lib/ai-edit";
import type { RunContext } from "./context";
import { type AiCallResult } from "./ai-call";
import { type AiEditIo, aiEditStep } from "./ai-edit-step";

/** Spec 0012 task 2: the `ai_edit` step with a fake Claude (AC-2, AC-7, AC-8, AC-9). */
export let testDb: TestDb;
export let db: JobDb;

/**
 * Opens the test file's own database and clears the built in backgrounds around the tests. Every
 * part file passes its own name (`take_studio_test_ai_edit_<part>`): the cleanup deletes all built
 * ins of the database, so two files running in parallel must never share one.
 */
export function registerDb(database: string) {
  beforeAll(async () => {
    // Its own database per file: the AI step sends every ready built in background in the prompt, so rows
    // other test files leave in the shared database could push the request over the input cap and
    // make the step skip as too_large (B2-T08). Clear built ins left by an earlier run of this file.
    testDb = await openTestDb({ database });
    db = testDb.db as unknown as JobDb;
    await testDb.db.delete(background).where(isNull(background.creatorId));
  });
  afterAll(async () => {
    if (testDb) await testDb.db.delete(background).where(isNull(background.creatorId));
    await testDb?.close();
  });
  afterEach(() => vi.clearAllMocks());
}

export const TITLE = "My very private title";
export const DURATION = 20_000;
export const WORDS = [
  { w: "Hello", startMs: 0, endMs: 400, conf: 1, filler: false, para: true },
  { w: "um", startMs: 500, endMs: 700, conf: 1, filler: true, para: false },
  { w: "I'm", startMs: 800, endMs: 1000, conf: 1, filler: false, para: false },
  { w: "Jon", startMs: 1100, endMs: 1400, conf: 1, filler: false, para: false },
];
export const CANDS: AiCandidate[] = [
  { startMs: 3000, endMs: 5000, reason: "Pause of 2.0 s" },
  { startMs: 8000, endMs: 10_000, reason: "Pause of 2.0 s" },
];

export async function seedRun(options: { withTranscript?: boolean; transcriptStep?: string } = {}) {
  const creator = await createCreator(testDb.db);
  const t = await seedTake(testDb.db, creator.id, {
    status: "processing",
    title: TITLE,
    durationMs: DURATION,
  });
  const [job] = await testDb.db
    .insert(processingJob)
    .values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "initial",
      status: "running",
      secondsCharged: 2,
    })
    .returning();
  if (!job) throw new Error("no job");
  for (const [position, name] of (["trim", "transcript", "ai_edit", "render"] as const).entries()) {
    const skipped = name === "transcript" && options.transcriptStep;
    await testDb.db.insert(jobStep).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      name,
      position,
      status: skipped ? "skipped" : "pending",
      failureCode: skipped ? options.transcriptStep : null,
    });
  }
  if (options.withTranscript !== false) {
    await testDb.db.insert(transcript).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      language: "en",
      text: "Hello um I'm Jon",
      words: WORDS,
      sourceFps: 30,
      model: "nova-3",
    });
  }
  // The trim step's rules cuts, as the full run stores them first.
  await testDb.db.insert(cut).values(
    CANDS.map((c) => ({
      id: crypto.randomUUID(),
      takeId: t.id,
      startMs: c.startMs,
      endMs: c.endMs,
      kind: "pause",
      proposedBy: "rules",
      reason: c.reason,
    })),
  );
  const ctx = {
    client: db,
    signal: new AbortController().signal,
    job,
    take: t,
    work: "/tmp/none",
    source: "/tmp/none/source.mp4",
    facts: { hasAudio: true, fps: 30, durationMs: DURATION },
  } as unknown as RunContext;
  return { ctx, take: t, job };
}

export const good: AiEditAnswer = {
  keepPauses: [{ candidate: 1, reason: "Deliberate beat" }],
  wordCuts: [{ fromWord: 1, toWord: 1, kind: "filler", reason: "Filler word" }],
  fixes: [{ index: 3, old: "Jon", new: "John", reason: "Name said earlier" }],
  background: null,
};
export const reply = (answer: unknown, over: Partial<AiCallResult> = {}): AiCallResult => ({
  text: typeof answer === "string" ? answer : JSON.stringify(answer),
  stopReason: "end_turn",
  inputTokens: 1000,
  outputTokens: 200,
  ...over,
});

export function io(over: Partial<AiEditIo> = {}) {
  const call = vi.fn<AiEditIo["call"]>(async () => reply(good));
  const report = vi.fn<AiEditIo["report"]>(async () => {});
  const value: AiEditIo = { apiKey: () => "key", call, pause: async () => {}, report, ...over };
  return { value, call, report };
}

export const stepOf = async (jobId: string) => {
  const rows = await db.select().from(jobStep).where(eq(jobStep.jobId, jobId));
  const found = rows.find((r) => r.name === "ai_edit");
  return { status: found?.status, code: found?.failureCode };
};
export const editsOf = async (takeId: string) =>
  (
    await db
      .select({ edits: transcript.edits })
      .from(transcript)
      .where(eq(transcript.takeId, takeId))
  )[0]?.edits;
export const cutsOf = (takeId: string) => db.select().from(cut).where(eq(cut.takeId, takeId));
export const run = (ctx: RunContext, value: AiEditIo, transcriptOutcome = "succeeded" as const) =>
  aiEditStep(ctx, ctx.signal, { transcript: transcriptOutcome, candidates: CANDS }, value);

/** The rules cuts are still stored, untouched. */
export async function expectRulesCuts(takeId: string) {
  const rows = await cutsOf(takeId);
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.proposedBy === "rules" && r.applied)).toBe(true);
}
