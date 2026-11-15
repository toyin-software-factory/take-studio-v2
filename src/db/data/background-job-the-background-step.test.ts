import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, jobStep } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { markRunning, startJob } from "./jobs";
import { SECRET, built } from "./background-job-test-helpers";

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
async function seedBackground(over: Partial<typeof background.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(background)
    .values({
      id,
      creatorId: null,
      name: "Test studio",
      imageKey: `backgrounds/builtin/${id}.jpg`,
      thumbKey: `backgrounds/builtin/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
      alt: "A test studio",
      ...over,
    })
    .returning();
  return built.track(row!);
}
async function takeWith(backgroundId: string | null) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { durationMs: 10_000, backgroundId });
  return { creator, take: t };
}
const start = (creatorId: string, takeId: string) =>
  startJob(db, { creatorId, takeId, usageSecret: SECRET });
describe("the background step", () => {
  it("accepts the no_green_screen skip reason and no other on a skipped step", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await takeWith(bg.id);
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    const { updateStep } = await import("./jobs");
    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const ok = await updateStep(db, {
      jobId: started.data.id,
      name: "background",
      status: "skipped",
      progress: 0,
      failureCode: "no_green_screen",
    });
    expect(ok.ok).toBe(true);
    const [step] = await db.select().from(jobStep).where(eq(jobStep.jobId, started.data.id));
    expect(step).toBeDefined();
    const bad = await updateStep(db, {
      jobId: started.data.id,
      name: "background",
      status: "skipped",
      progress: 0,
      failureCode: "ffmpeg_error",
    });
    expect(bad.ok).toBe(false);
  });
});
