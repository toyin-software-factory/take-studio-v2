import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTranscribeJob } from "@/db/data/jobs";
import { background, processingJob, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { cancel } from "../jobs";
import { type BackgroundHttpDeps, TRANSCRIPT_RUNNING_MESSAGE } from "./http";
import { ORIGIN, built, call } from "./background-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_background_put_api_takes" });
  db = testDb.db;
});
afterAll(async () => {
  if (testDb) await built.clean(testDb.db);
  await testDb?.close();
});
function deps(creatorId: string | null, triggered: string[] = [], failTrigger = false) {
  const value: BackgroundHttpDeps = {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    triggerProcessTake: async (jobId) => {
      if (failTrigger) throw new Error("trigger down");
      triggered.push(jobId);
      return { id: `run_${jobId}` };
    },
  };
  return value;
}
async function seedBackground(over: Partial<typeof background.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(background)
    .values({
      id,
      creatorId: null,
      name: "Studio",
      imageKey: `backgrounds/builtin/${id}.jpg`,
      thumbKey: `backgrounds/builtin/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
      ...over,
    })
    .returning();
  return built.track(row!);
}
async function readyTake(opts: { backgroundId?: string; keyed?: boolean } = {}) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, {
    status: "ready",
    durationMs: 10_000,
    backgroundId: opts.backgroundId ?? null,
  });
  const jobId = crypto.randomUUID();
  await db.insert(processingJob).values({
    id: jobId,
    takeId: t.id,
    kind: "initial",
    status: "succeeded",
    secondsCharged: 10,
    targetBackgroundId: opts.backgroundId ?? null,
  });
  const renderId = crypto.randomUUID();
  await db.insert(render).values({
    id: renderId,
    takeId: t.id,
    jobId,
    status: "succeeded",
    videoKey: `renders/${t.id}/${renderId}.mp4`,
    durationMs: 9_000,
    removedRanges: [],
    isLatest: true,
    backgroundId: opts.backgroundId ?? null,
    backgroundName: opts.backgroundId ? "Studio" : null,
    keyed: opts.keyed ?? false,
    keyColor: opts.keyed ? "#00b140" : null,
  });
  return { creator, take: t, jobId };
}
describe("PUT /api/takes/[id]/background (spec 0008, AC-5, AC-6)", () => {
  it("says the video is still being made while another job runs, and the transcript wording while a transcript is", async () => {
    const bg = await seedBackground();
    const first = await readyTake();
    expect(
      (await call(deps(first.creator.id), first.take.id, { backgroundId: bg.id })).status,
    ).toBe(202);
    const busy = await call(deps(first.creator.id), first.take.id, { backgroundId: bg.id });
    expect([busy.status, busy.json.error]).toEqual([409, "job_active"]);
    expect(busy.json.message).toBe(
      "A background change is already running. It'll show here when it's done.",
    );

    const second = await readyTake();
    await startTranscribeJob(db, { takeId: second.take.id });
    const transcribing = await call(deps(second.creator.id), second.take.id, {
      backgroundId: bg.id,
    });
    expect([transcribing.status, transcribing.json.error]).toEqual([409, "job_active"]);
    expect(transcribing.json.message).toBe(TRANSCRIPT_RUNNING_MESSAGE);
  });

  it("finishes the job trigger_failed at once when the trigger throws (503), the take untouched", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const res = await call(deps(creator.id, [], true), t.id, { backgroundId: bg.id });
    expect(res.status).toBe(503);
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    const rerender = jobs.find((j) => j.kind === "background");
    expect(rerender).toMatchObject({ status: "failed", failureCode: "trigger_failed" });
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.status).toBe("ready");
    // Not stuck: try again works.
    expect((await call(deps(creator.id), t.id, { backgroundId: bg.id })).status).toBe(202);
  });

  it("the creator can cancel a change; the take stays Ready", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const res = await call(deps(creator.id), t.id, { backgroundId: bg.id });
    const cancelled = await cancel(db, { creatorId: creator.id, jobId: res.json.jobId as string });
    expect(cancelled.ok).toBe(true);
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.status).toBe("ready");
  });
});
