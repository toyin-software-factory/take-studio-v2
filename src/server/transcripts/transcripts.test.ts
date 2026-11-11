import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish, markRunning, startTranscribeJob, updateStep } from "@/db/data/jobs";
import { upsertTranscript } from "@/db/data/transcripts";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { handleGetTranscript } from "./http";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const words = [
  { w: "Hello", startMs: 100, endMs: 400, conf: 1, filler: false, para: true },
  { w: "um", startMs: 500, endMs: 600, conf: 1, filler: true, para: false },
  { w: "Again", startMs: 5000, endMs: 5400, conf: 1, filler: false, para: true },
];

const get = async (creatorId: string | null, takeId: string) =>
  handleGetTranscript(new Request(`https://x.test/api/takes/${takeId}/transcript`), takeId, {
    allowedOrigin: "https://x.test",
    getCreator: async () => (creatorId ? { db, creatorId } : null),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

async function setup() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready" });
  return { creator, t };
}

describe("GET /api/takes/[id]/transcript (spec 0007)", () => {
  it("needs a session and the owner", async () => {
    const { creator, t } = await setup();
    expect((await get(null, t.id)).status).toBe(401);
    const other = await createCreator(db);
    expect((await get(other.id, t.id)).status).toBe(404);
    expect((await get(creator.id, "not-a-uuid")).status).toBe(404);
  });

  it("is none and can be made for a ready take with no job", async () => {
    const { creator, t } = await setup();
    expect((await get(creator.id, t.id)).body).toEqual({ state: "none", canMake: true });
  });

  it("is making while a transcribe job runs", async () => {
    const { creator, t } = await setup();
    await startTranscribeJob(db, { takeId: t.id });
    expect((await get(creator.id, t.id)).body).toEqual({ state: "making", canMake: false });
  });

  it("is ready with plain paragraphs once the row exists", async () => {
    const { creator, t } = await setup();
    await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "t",
      words,
      sourceFps: 30,
      model: "nova-3",
    });
    const { body } = await get(creator.id, t.id);
    expect(body.state).toBe("ready");
    expect(body.version).toMatch(/^\d+\.none$/);
    const paragraphs = body.paragraphs as { startMs: number; words: { w: string }[] }[];
    expect(paragraphs.map((p) => [p.startMs, p.words.map((w) => w.w)])).toEqual([
      [100, ["Hello", "um"]],
      [5000, ["Again"]],
    ]);
  });

  it("is skipped with the reason", async () => {
    const { creator, t } = await setup();
    const started = await startTranscribeJob(db, { takeId: t.id });
    if (!started.ok) throw new Error("start");
    const jobId = started.data.id;
    await markRunning(db, { jobId, triggerRunId: "run" });
    await updateStep(db, {
      jobId,
      name: "transcript",
      status: "skipped",
      progress: 0,
      failureCode: "not_english",
    });
    await finish(db, { jobId, status: "succeeded" });
    expect((await get(creator.id, t.id)).body).toEqual({
      state: "skipped",
      reason: "not_english",
      canMake: false,
    });
  });

  it("is failed and can be tried again after a failed job", async () => {
    const { creator, t } = await setup();
    const started = await startTranscribeJob(db, { takeId: t.id });
    if (!started.ok) throw new Error("start");
    await finish(db, { jobId: started.data.id, status: "failed", failureCode: "provider_error" });
    expect((await get(creator.id, t.id)).body).toEqual({ state: "failed", canMake: true });
  });

  it("cannot be made on an expired take", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "expired" });
    expect((await get(creator.id, t.id)).body).toEqual({ state: "none", canMake: false });
  });
});
