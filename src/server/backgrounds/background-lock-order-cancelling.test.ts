import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markRunning } from "@/db/data/jobs";
import { background, processingJob, render } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { cancel } from "../jobs";
import { type BackgroundHttpDeps } from "./http";
import { ORIGIN, built, call } from "./background-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
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
describe("lock order: cancelling a change and deleting its target (spec 0008)", () => {
  it("never deadlock, and neither rejects", async () => {
    let failed = 0;
    for (let i = 0; i < 20; i++) {
      const target = await seedBackground();
      const { creator, take: t } = await readyTake();
      const res = await call(deps(creator.id), t.id, { backgroundId: target.id });
      await markRunning(db, { jobId: res.json.jobId as string, triggerRunId: "run" });
      const settled = await Promise.allSettled([
        cancel(db, { creatorId: creator.id, jobId: res.json.jobId as string }),
        db.delete(background).where(eq(background.id, target.id)),
      ]);
      // Any rejection fails the round: a deadlock (40P01) or any other error.
      failed += settled.filter((s) => s.status === "rejected").length;
    }
    expect(failed).toBe(0);
  }, 60_000);
});
