import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { JobDb } from "@/db/client/job";
import {
  background,
  cut,
  jobStep,
  processingJob,
  take as takeTable,
  transcript,
} from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { AiCandidate, AiEditAnswer } from "@/lib/ai-edit";
import type { RunContext } from "./context";

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { type AiCallResult, AiCallError } from "./ai-call";
import { type AiEditIo, aiEditStep } from "./ai-edit-step";

/** Spec 0012 task 2: the `ai_edit` step with a fake Claude (AC-2, AC-7, AC-8, AC-9). */
let testDb: TestDb;
let db: JobDb;
beforeAll(async () => {
  // Its own database: the AI step sends every ready built in background in the prompt, so rows
  // other test files leave in the shared database could push the request over the input cap and
  // make the step skip as too_large (B2-T08). Clear built ins left by an earlier run of this file.
  testDb = await openTestDb({ database: "take_studio_test_ai_edit" });
  db = testDb.db as unknown as JobDb;
  await testDb.db.delete(background).where(isNull(background.creatorId));
});
afterAll(async () => {
  if (testDb) await testDb.db.delete(background).where(isNull(background.creatorId));
  await testDb?.close();
});
afterEach(() => vi.clearAllMocks());

const TITLE = "My very private title";
const DURATION = 20_000;
const WORDS = [
  { w: "Hello", startMs: 0, endMs: 400, conf: 1, filler: false, para: true },
  { w: "um", startMs: 500, endMs: 700, conf: 1, filler: true, para: false },
  { w: "I'm", startMs: 800, endMs: 1000, conf: 1, filler: false, para: false },
  { w: "Jon", startMs: 1100, endMs: 1400, conf: 1, filler: false, para: false },
];
const CANDS: AiCandidate[] = [
  { startMs: 3000, endMs: 5000, reason: "Pause of 2.0 s" },
  { startMs: 8000, endMs: 10_000, reason: "Pause of 2.0 s" },
];

async function seedRun(options: { withTranscript?: boolean; transcriptStep?: string } = {}) {
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

const good: AiEditAnswer = {
  keepPauses: [{ candidate: 1, reason: "Deliberate beat" }],
  wordCuts: [{ fromWord: 1, toWord: 1, kind: "filler", reason: "Filler word" }],
  fixes: [{ index: 3, old: "Jon", new: "John", reason: "Name said earlier" }],
  background: null,
};
const reply = (answer: unknown, over: Partial<AiCallResult> = {}): AiCallResult => ({
  text: typeof answer === "string" ? answer : JSON.stringify(answer),
  stopReason: "end_turn",
  inputTokens: 1000,
  outputTokens: 200,
  ...over,
});

function io(over: Partial<AiEditIo> = {}) {
  const call = vi.fn<AiEditIo["call"]>(async () => reply(good));
  const report = vi.fn<AiEditIo["report"]>(async () => {});
  const value: AiEditIo = { apiKey: () => "key", call, pause: async () => {}, report, ...over };
  return { value, call, report };
}

const stepOf = async (jobId: string) => {
  const rows = await db.select().from(jobStep).where(eq(jobStep.jobId, jobId));
  const found = rows.find((r) => r.name === "ai_edit");
  return { status: found?.status, code: found?.failureCode };
};
const editsOf = async (takeId: string) =>
  (
    await db
      .select({ edits: transcript.edits })
      .from(transcript)
      .where(eq(transcript.takeId, takeId))
  )[0]?.edits;
const cutsOf = (takeId: string) => db.select().from(cut).where(eq(cut.takeId, takeId));
const run = (ctx: RunContext, value: AiEditIo, transcriptOutcome = "succeeded" as const) =>
  aiEditStep(ctx, ctx.signal, { transcript: transcriptOutcome, candidates: CANDS }, value);

/** The rules cuts are still stored, untouched. */
async function expectRulesCuts(takeId: string) {
  const rows = await cutsOf(takeId);
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.proposedBy === "rules" && r.applied)).toBe(true);
}

describe("aiEditStep", () => {
  it("happy path: AI cuts with reasons, a kept pause unapplied, one call (AC-2, AC-9)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, call, report } = io();
    expect(await run(ctx, value)).toEqual({ status: "succeeded", hasCuts: true });
    expect(call).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "succeeded", code: null });
    const rows = (await cutsOf(take.id)).sort((a, b) => a.startMs - b.startMs);
    expect(rows.every((r) => r.proposedBy === "ai" && r.reason)).toBe(true);
    expect(rows.map((r) => [r.kind, r.startMs, r.endMs, r.applied])).toEqual([
      ["filler", 500, 800, true],
      ["pause", 3000, 5000, true],
      ["pause", 8000, 10_000, false],
    ]);
    // Spec 0012 task 4: the fixes are stored with the cuts, none undone, and the words are untouched.
    expect(await editsOf(take.id)).toEqual([
      { index: 3, old: "Jon", new: "John", reason: "Name said earlier", undone: false },
    ]);
    const [row] = await db.select().from(transcript).where(eq(transcript.takeId, take.id));
    expect(row?.words[3]?.w).toBe("Jon");
  });

  it("sends only words, candidates, length: no title, name, email, take ID or URL (AC-8)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, call } = io();
    await run(ctx, value);
    const request = call.mock.calls[0]?.[0];
    const text = `${request?.system}\n${request?.user}`;
    for (const secret of [TITLE, take.id, job.id, take.creatorId, "http", "@", take.originalKey]) {
      expect(text).not.toContain(secret);
    }
    expect(request?.user).toContain("3|Jon|1100|1400|");
  });

  it("falls back on a timeout: rules cuts stay, skipped ai_unavailable, one report with IDs (AC-7)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, report } = io({
      call: async () => {
        throw new AiCallError("timeout", false);
      },
    });
    expect(await run(ctx, value)).toEqual({ status: "skipped", hasCuts: null });
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    await expectRulesCuts(take.id);
    expect(await editsOf(take.id)).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause: "timeout" });
  });

  it.each([
    ["invalid JSON", reply("not json {"), "invalid"],
    ["schema failure", reply({ keepPauses: [] }), "invalid"],
    ["max_tokens", reply(good, { stopReason: "max_tokens" }), "cutoff"],
    ["a refusal", reply(good, { stopReason: "refusal" }), "provider_rejected"],
    ["no text", reply(good, { text: null }), "invalid"],
    [
      "a bad fix",
      reply({
        keepPauses: [],
        wordCuts: [],
        fixes: [{ index: 3, old: "Jan", new: "John", reason: "r" }],
        background: null,
      }),
      "invalid",
    ],
  ])("falls back on %s", async (_name, answer, cause) => {
    const { ctx, take, job } = await seedRun();
    const { value, report } = io({ call: async () => answer });
    const out = await run(ctx, value);
    expect(out).toEqual({ status: "skipped", hasCuts: null });
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    await expectRulesCuts(take.id);
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause });
  });

  it("falls back when word cuts take over 40 % of the take", async () => {
    const { ctx, take, job } = await seedRun();
    const words = [
      { ...WORDS[0]!, endMs: 400 },
      { ...WORDS[1]!, startMs: 500 },
      { ...WORDS[2]!, startMs: 9000, endMs: 9200 },
    ];
    await testDb.db.update(transcript).set({ words }).where(eq(transcript.takeId, take.id));
    const answer = {
      keepPauses: [],
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "x" }], // 500..9000, 42.5 % of 20 000
      fixes: [],
      background: null,
    };
    const { value, report } = io({ call: async () => reply(answer) });
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause: "invalid" });
    await expectRulesCuts(take.id);
  });

  it("a missing key is ai_unavailable (no_key), never an abort, and Claude is not called", async () => {
    const { ctx, job, take } = await seedRun();
    const { value, call, report } = io({ apiKey: () => null });
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause: "no_key" });
    const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(j?.status).toBe("running");
  });

  it("a request over the input guard is not sent (too_large)", async () => {
    const { ctx, take } = await seedRun();
    const many = Array.from({ length: 25_000 }, (_, i) => ({
      ...WORDS[0]!,
      startMs: i,
      endMs: i + 1,
    }));
    await testDb.db.update(transcript).set({ words: many }).where(eq(transcript.takeId, take.id));
    const { value, call, report } = io();
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
    expect(report.mock.calls[0]?.[0].cause).toBe("too_large");
  });

  it("retries once on a 429 or 5xx, then succeeds", async () => {
    const { ctx } = await seedRun();
    const call = vi
      .fn<AiEditIo["call"]>()
      .mockRejectedValueOnce(new AiCallError("provider_error", true))
      .mockResolvedValue(reply(good));
    const out = await run(ctx, io({ call }).value);
    expect(out.status).toBe("succeeded");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("retries only once, and never for a rejection", async () => {
    const { ctx, job } = await seedRun();
    const twice = vi
      .fn<AiEditIo["call"]>()
      .mockRejectedValue(new AiCallError("provider_error", true));
    const a = io({ call: twice });
    expect((await run(ctx, a.value)).status).toBe("skipped");
    expect(twice).toHaveBeenCalledTimes(2);
    expect(a.report.mock.calls[0]?.[0].cause).toBe("provider_error");
    expect((await stepOf(job.id)).code).toBe("ai_unavailable");

    const other = await seedRun();
    const rejected = vi
      .fn<AiEditIo["call"]>()
      .mockRejectedValue(new AiCallError("provider_rejected", false));
    const b = io({ call: rejected });
    await run(other.ctx, b.value);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(b.report.mock.calls[0]?.[0].cause).toBe("provider_rejected");
  });

  it("does not retry once the deadline fired", async () => {
    const { ctx } = await seedRun();
    const edit = new AbortController();
    const call = vi.fn<AiEditIo["call"]>(async () => {
      edit.abort();
      throw new AiCallError("provider_error", true);
    });
    const { value, report } = io({ call });
    await aiEditStep(ctx, edit.signal, { transcript: "succeeded", candidates: CANDS }, value);
    expect(call).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0].cause).toBe("timeout");
  });

  it("a failed in run transcript falls back as transcript_failed without calling Claude", async () => {
    const { ctx, job, take } = await seedRun({ withTranscript: false });
    const { value, call, report } = io();
    expect((await run(ctx, value, "failed" as never)).status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    expect(report).toHaveBeenCalledWith({
      takeId: take.id,
      jobId: job.id,
      cause: "transcript_failed",
    });
  });

  it.each(["not_english", "no_speech"])(
    "a %s take skips with the same reason and sends no message",
    async (reason) => {
      const { ctx, job, take } = await seedRun({ withTranscript: false, transcriptStep: reason });
      const { value, call, report } = io();
      expect((await run(ctx, value, "skipped" as never)).status).toBe("skipped");
      expect(call).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
      expect(await stepOf(job.id)).toEqual({ status: "skipped", code: reason });
      await expectRulesCuts(take.id);
    },
  );

  it("reuses a final step on attempt 2: no second Claude call, no change", async () => {
    const { ctx, job } = await seedRun();
    const first = io();
    await run(ctx, first.value);
    const second = io();
    expect((await run(ctx, second.value)).hasCuts).toBeNull();
    expect(second.call).not.toHaveBeenCalled();
    expect((await stepOf(job.id)).status).toBe("succeeded");
  });

  it("keeps a cut the creator changed (AC-2)", async () => {
    const { ctx, take } = await seedRun();
    await testDb.db
      .update(cut)
      .set({ creatorChangedAt: new Date(), applied: false })
      .where(and(eq(cut.takeId, take.id), eq(cut.startMs, 3000)));
    const { value } = io({
      call: async () => reply({ keepPauses: [], wordCuts: [], fixes: [], background: null }),
    });
    await run(ctx, value);
    const rows = await cutsOf(take.id);
    const mine = rows.filter((r) => r.startMs === 3000);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ proposedBy: "rules", applied: false });
  });

  it("writes nothing once the job is final, and the run stops", async () => {
    const { ctx, job, take } = await seedRun();
    await db.update(processingJob).set({ status: "cancelled" }).where(eq(processingJob.id, job.id));
    await expect(run(ctx, io().value)).rejects.toThrow();
    await expectRulesCuts(take.id);
  });

  it("logs and reports no text from the take, the prompt or the answer", async () => {
    const { logger } = await import("@trigger.dev/sdk");
    const { ctx } = await seedRun();
    await run(ctx, io().value);
    const logged = JSON.stringify([
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
    ]);
    for (const secret of ["Jon", "Hello", "Deliberate beat", "Filler word", TITLE]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain("inputTokens");
  });
});

/** Spec 0012 part 6 (AC-5, AC-8): the built in catalog in the request and the suggestion. */
describe("aiEditStep background suggestion", () => {
  const NAME_SECRET = "My private upload name";

  async function seedBackgrounds() {
    const creator = await createCreator(testDb.db);
    const mk = (over: Partial<typeof background.$inferInsert>) => ({
      id: crypto.randomUUID(),
      name: "Loft",
      alt: "A bright loft",
      status: "ready",
      imageKey: "backgrounds/x/image.jpg",
      thumbKey: "backgrounds/x/thumb.webp",
      width: 1920,
      height: 1080,
      ...over,
    });
    const builtIn = mk({ name: "Sunny loft", alt: "A sunny loft with plants" });
    const notReady = mk({ name: "Half done", status: "processing" });
    const upload = mk({ name: NAME_SECRET, creatorId: creator.id });
    await testDb.db.insert(background).values([builtIn, notReady, upload]);
    return { builtIn, notReady, upload };
  }

  const suggestionOf = async (takeId: string) =>
    (
      await db
        .select({
          id: takeTable.suggestedBackgroundId,
          reason: takeTable.suggestionReason,
        })
        .from(takeTable)
        .where(eq(takeTable.id, takeId))
    )[0];

  it("sends only ready built in backgrounds (ID, name, alt), never an upload", async () => {
    const { builtIn, notReady, upload } = await seedBackgrounds();
    const { ctx } = await seedRun();
    const { value, call } = io();
    await run(ctx, value);
    const user = call.mock.calls[0]?.[0]?.user ?? "";
    expect(user).toContain(`${builtIn.id}|Sunny loft|A sunny loft with plants`);
    for (const hidden of [notReady.id, upload.id, NAME_SECRET]) expect(user).not.toContain(hidden);
  });

  it("stores a valid suggestion with its reason in the same write as the cuts", async () => {
    const { builtIn } = await seedBackgrounds();
    const { ctx, take } = await seedRun();
    const answer = { ...good, background: { id: builtIn.id, reason: "Warm and bright, like you" } };
    const { value } = io({ call: async () => reply(answer) });
    expect((await run(ctx, value)).status).toBe("succeeded");
    expect(await suggestionOf(take.id)).toEqual({
      id: builtIn.id,
      reason: "Warm and bright, like you",
    });
  });

  it("a bad ID gives no suggestion and the rest of the answer still applies", async () => {
    await seedBackgrounds();
    const { ctx, take } = await seedRun();
    const answer = { ...good, background: { id: crypto.randomUUID(), reason: "Nice one" } };
    const { value } = io({ call: async () => reply(answer) });
    expect((await run(ctx, value)).status).toBe("succeeded");
    expect(await suggestionOf(take.id)).toEqual({ id: null, reason: null });
    expect((await editsOf(take.id))?.length).toBe(1);
  });

  it("an upload or a not ready background is not a valid suggestion", async () => {
    const { upload, notReady } = await seedBackgrounds();
    for (const id of [upload.id, notReady.id]) {
      const { ctx, take } = await seedRun();
      const { value } = io({
        call: async () => reply({ ...good, background: { id, reason: "Looks good" } }),
      });
      await run(ctx, value);
      expect(await suggestionOf(take.id)).toEqual({ id: null, reason: null });
    }
  });

  it("a fallback clears a suggestion stored earlier", async () => {
    const { builtIn } = await seedBackgrounds();
    const { ctx, take } = await seedRun();
    await db
      .update(takeTable)
      .set({ suggestedBackgroundId: builtIn.id, suggestionReason: "Old reason" })
      .where(eq(takeTable.id, take.id));
    const { value } = io({ call: async () => reply("not json") });
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(await suggestionOf(take.id)).toEqual({ id: null, reason: null });
  });

  it("the reason column refuses more than 280 characters", async () => {
    const { take } = await seedRun();
    await expect(
      db
        .update(takeTable)
        .set({ suggestionReason: "x".repeat(281) })
        .where(eq(takeTable.id, take.id)),
    ).rejects.toThrow();
  });
});
