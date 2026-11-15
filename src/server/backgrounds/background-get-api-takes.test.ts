import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish, markRunning } from "@/db/data/jobs";
import { background, jobStep, processingJob, render } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type TakeHttpDeps, handleGet } from "../takes/http";
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
describe("GET /api/takes/[id] background fields (spec 0008)", () => {
  const takeDeps = (creatorId: string): TakeHttpDeps => ({
    allowedOrigin: ORIGIN,
    getCreator: async () => ({ db, creatorId }),
    usageSecret: () => "x".repeat(40),
    triggerProcessTake: async () => ({ id: "run" }),
  });
  const get = async (creatorId: string, takeId: string) => {
    const res = await handleGet(
      new Request("https://x.test/api/takes/x"),
      takeId,
      takeDeps(creatorId),
    );
    return (await res.json()) as {
      background: { id: string | null; name: string; keyed: boolean } | null;
      noGreenScreen: boolean;
      backgroundJob: {
        status: string;
        failureCode: string | null;
        targetBackgroundId: string | null;
      } | null;
    };
  };

  it("names the keyed background, with no change job yet", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake({ backgroundId: bg.id, keyed: true });
    expect(await get(creator.id, t.id)).toMatchObject({
      background: { id: bg.id, name: "Studio", keyed: true },
      noGreenScreen: false,
      backgroundJob: null,
    });
  });

  it("flags no green screen when the render named a background but did not key", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake({ backgroundId: bg.id, keyed: false });
    expect(await get(creator.id, t.id)).toMatchObject({ background: null, noGreenScreen: true });
  });

  it("flags no green screen from a skipped background step too", async () => {
    const { creator, take: t, jobId } = await readyTake();
    await db.insert(jobStep).values({
      id: crypto.randomUUID(),
      jobId,
      name: "background",
      position: 1,
      status: "skipped",
      progress: 0,
      failureCode: "no_green_screen",
    });
    expect((await get(creator.id, t.id)).noGreenScreen).toBe(true);
  });

  it("reports the latest change job, and a failed one for Try again", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const res = await call(deps(creator.id), t.id, { backgroundId: bg.id });
    expect((await get(creator.id, t.id)).backgroundJob).toEqual({
      status: "queued",
      failureCode: null,
      targetBackgroundId: bg.id,
    });
    await markRunning(db, { jobId: res.json.jobId as string, triggerRunId: "run" });
    await finish(db, {
      jobId: res.json.jobId as string,
      status: "failed",
      failureCode: "ffmpeg_error",
    });
    expect((await get(creator.id, t.id)).backgroundJob).toEqual({
      status: "failed",
      failureCode: "ffmpeg_error",
      targetBackgroundId: bg.id,
    });
  });

  it("returns the target of the latest change, so Try again repeats it", async () => {
    const bg = await seedBackground();
    const first = await seedBackground();
    // Keyed on `first`, so going back to the original is a real change (no failed job exemption).
    const { creator, take: t } = await readyTake({ backgroundId: first.id, keyed: true });
    const res = await call(deps(creator.id), t.id, { backgroundId: bg.id });
    await markRunning(db, { jobId: res.json.jobId as string, triggerRunId: "run" });
    await finish(db, {
      jobId: res.json.jobId as string,
      status: "failed",
      failureCode: "ffmpeg_error",
    });
    expect((await get(creator.id, t.id)).backgroundJob).toEqual({
      status: "failed",
      failureCode: "ffmpeg_error",
      targetBackgroundId: bg.id,
    });
    const orig = await call(deps(creator.id), t.id, { backgroundId: "original" });
    await markRunning(db, { jobId: orig.json.jobId as string, triggerRunId: "run" });
    await finish(db, {
      jobId: orig.json.jobId as string,
      status: "failed",
      failureCode: "ffmpeg_error",
    });
    expect((await get(creator.id, t.id)).backgroundJob?.targetBackgroundId).toBeNull();
  });

  it("does not take the no green screen note from a change that failed", async () => {
    const bg = await seedBackground();
    const other = await seedBackground();
    const { creator, take: t } = await readyTake({ backgroundId: bg.id, keyed: true });
    const res = await call(deps(creator.id), t.id, { backgroundId: other.id });
    const jobId = res.json.jobId as string;
    await markRunning(db, { jobId, triggerRunId: "run" });
    await db
      .update(jobStep)
      .set({ status: "skipped", failureCode: "no_green_screen" })
      .where(eq(jobStep.jobId, jobId));
    // While it runs, the skip is what the page is about to show.
    expect((await get(creator.id, t.id)).noGreenScreen).toBe(true);
    await finish(db, { jobId, status: "failed", failureCode: "ffmpeg_error" });
    // The video on the page is still the keyed one: no note.
    expect((await get(creator.id, t.id)).noGreenScreen).toBe(false);
  });

  it("a `rerender` is not a background change, so it is never the latest change", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "ready", durationMs: 5_000 });
    await db.insert(processingJob).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "rerender",
      status: "failed",
      failureCode: "ffmpeg_error",
      secondsCharged: 0,
    });
    expect((await get(creator.id, t.id)).backgroundJob).toBeNull();
  });
});
