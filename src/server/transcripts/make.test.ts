import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish, startJob, startTranscribeJob } from "@/db/data/jobs";
import { upsertTranscript } from "@/db/data/transcripts";
import { processingJob, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type TakeHttpDeps, handleRetry } from "../takes/http";
import { type TranscriptHttpDeps, handleMakeTranscript } from "./http";

const ORIGIN = "https://take-studio.example";
const JOB_ACTIVE = "Your transcript is still being made. Try again in a moment.";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

function deps(creatorId: string | null, triggered: string[] = [], failTrigger = false) {
  const value: TranscriptHttpDeps = {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    triggerTranscribe: async (jobId) => {
      if (failTrigger) throw new Error("trigger down");
      triggered.push(jobId);
      return { id: `run_${jobId}` };
    },
  };
  return value;
}

const post = (origin: string | null = ORIGIN) =>
  new Request("https://x.test/api/takes/x/transcript", {
    method: "POST",
    headers: origin ? { origin } : {},
  });

const call = async (d: TranscriptHttpDeps, takeId: string, origin: string | null = ORIGIN) => {
  const res = await handleMakeTranscript(post(origin), takeId, d);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

async function setup(over: Partial<typeof take.$inferInsert> = {}) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", ...over });
  return { creator, t };
}

const jobsOf = (takeId: string) =>
  db.select().from(processingJob).where(eq(processingJob.takeId, takeId));

describe("POST /api/takes/[id]/transcript (spec 0007, AC-9, AC-11)", () => {
  it("starts a transcribe job, triggers it, charges nothing and keeps the take Ready", async () => {
    const { creator, t } = await setup();
    const triggered: string[] = [];
    const { status, body } = await call(deps(creator.id, triggered), t.id);
    expect([status, body]).toEqual([202, { state: "making" }]);
    const [job] = await jobsOf(t.id);
    expect(job).toMatchObject({ kind: "transcribe", secondsCharged: 0 });
    expect(triggered).toEqual([job!.id]);
    const [after] = await db.select().from(take).where(eq(take.id, t.id));
    expect(after?.status).toBe("ready");
  });

  it("answers 403 without a good Origin, before anything else", async () => {
    const { creator, t } = await setup();
    expect((await call(deps(creator.id), t.id, null)).status).toBe(403);
    expect((await call(deps(creator.id), t.id, "https://evil.example")).status).toBe(403);
    expect(await jobsOf(t.id)).toHaveLength(0);
  });

  it("answers 401 without a session and 404 for another creator's or a malformed take", async () => {
    const { creator, t } = await setup();
    expect((await call(deps(null), t.id)).status).toBe(401);
    const other = await createCreator(db);
    expect((await call(deps(other.id), t.id)).status).toBe(404);
    expect((await call(deps(creator.id), "not-a-uuid")).status).toBe(404);
    expect(await jobsOf(t.id)).toHaveLength(0);
  });

  it("refuses with 409 job_active while a job runs, with the friendly message", async () => {
    const { creator, t } = await setup();
    await call(deps(creator.id), t.id);
    const again = await call(deps(creator.id), t.id);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "job_active", message: JOB_ACTIVE });
    expect(await jobsOf(t.id)).toHaveLength(1);
  });

  it("refuses with 409 original_gone for an expired take", async () => {
    const { creator, t } = await setup({ status: "expired" });
    const res = await call(deps(creator.id), t.id);
    expect([res.status, res.body.error]).toEqual([409, "original_gone"]);
  });

  it("refuses with 409 already_done when the transcript exists", async () => {
    const { creator, t } = await setup();
    await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "t",
      words: [],
      sourceFps: 30,
      model: "nova-3",
    });
    const res = await call(deps(creator.id), t.id);
    expect([res.status, res.body.error]).toEqual([409, "already_done"]);
  });

  it("refuses with 409 not_ready for a take that is still processing", async () => {
    const { creator, t } = await setup({ status: "processing" });
    const res = await call(deps(creator.id), t.id);
    expect([res.status, res.body.error]).toEqual([409, "not_ready"]);
  });

  it("lets a failed transcript be tried again (Try again)", async () => {
    const { creator, t } = await setup();
    await call(deps(creator.id), t.id);
    const [first] = await jobsOf(t.id);
    await finish(db, { jobId: first!.id, status: "failed", failureCode: "provider_error" });
    const again = await call(deps(creator.id), t.id);
    expect(again.status).toBe(202);
    expect(await jobsOf(t.id)).toHaveLength(2);
  });

  it("finishes the job trigger_failed at once when the trigger throws, and answers 503", async () => {
    const { creator, t } = await setup();
    const res = await call(deps(creator.id, [], true), t.id);
    expect(res.status).toBe(503);
    const [job] = await jobsOf(t.id);
    expect(job).toMatchObject({ status: "failed", failureCode: "trigger_failed" });
    // Not stuck: the creator can try again right away.
    expect((await call(deps(creator.id), t.id)).status).toBe(202);
  });
});

describe("another job start while a transcript is being made (spec 0007, AC-9)", () => {
  it("retry says the transcript is still being made", async () => {
    const { creator, t } = await setup();
    await startTranscribeJob(db, { takeId: t.id });
    const takeDeps: TakeHttpDeps = {
      allowedOrigin: ORIGIN,
      getCreator: async () => ({ db, creatorId: creator.id }),
      usageSecret: () => "x".repeat(40),
      triggerProcessTake: async () => ({ id: "run" }),
    };
    const res = await handleRetry(post(), t.id, takeDeps);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "transcript_running", message: JOB_ACTIVE });
  });

  it("startJob is refused while a transcribe job runs", async () => {
    const { creator, t } = await setup();
    await startTranscribeJob(db, { takeId: t.id });
    const started = await startJob(db, {
      creatorId: creator.id,
      takeId: t.id,
      usageSecret: "x".repeat(40),
    });
    expect(started.ok).toBe(false);
  });
});
