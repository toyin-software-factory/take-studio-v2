import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, processingJob, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
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
describe("PUT /api/takes/[id]/background (spec 0008, AC-5, AC-6)", () => {
  it("starts a free re render, triggers process-take and leaves the take Ready (202)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const triggered: string[] = [];
    const res = await call(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect(res.status).toBe(202);
    const [job] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, res.json.jobId as string));
    expect(job).toMatchObject({
      kind: "background",
      status: "queued",
      secondsCharged: 0,
      targetBackgroundId: bg.id,
    });
    expect(triggered).toEqual([job!.id]);
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.status).toBe("ready");
  });

  it('accepts "original" and sends it as no target', async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake({ backgroundId: bg.id, keyed: true });
    const res = await call(deps(creator.id), t.id, { backgroundId: "original" });
    expect(res.status).toBe(202);
    const [job] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, res.json.jobId as string));
    expect(job?.targetBackgroundId).toBeNull();
  });

  it("checks Origin first (403), then the session (401), then the body (422)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    expect((await call(deps(creator.id), t.id, { backgroundId: bg.id }, null)).status).toBe(403);
    expect(
      (await call(deps(creator.id), t.id, { backgroundId: bg.id }, "https://evil.example")).status,
    ).toBe(403);
    expect((await call(deps(null), t.id, { backgroundId: bg.id })).status).toBe(401);
    for (const bad of [{}, { backgroundId: "nope" }, { backgroundId: 5 }, null]) {
      expect((await call(deps(creator.id), t.id, bad)).status).toBe(422);
    }
    expect(
      await db.select().from(processingJob).where(eq(processingJob.takeId, t.id)),
    ).toHaveLength(
      1, // only the seeded initial job
    );
  });

  it("answers 404 for another creator's take, a malformed ID, and a background that is not theirs", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const stranger = await createCreator(db);
    expect((await call(deps(stranger.id), t.id, { backgroundId: bg.id })).status).toBe(404);
    expect((await call(deps(creator.id), "not-a-uuid", { backgroundId: bg.id })).status).toBe(404);
    const theirs = await seedBackground({ creatorId: stranger.id });
    expect((await call(deps(creator.id), t.id, { backgroundId: theirs.id })).status).toBe(404);
    expect((await call(deps(creator.id), t.id, { backgroundId: crypto.randomUUID() })).status).toBe(
      404,
    );
  });

  it("refuses with 409 and a friendly message: not ready, background not ready, expired, same", async () => {
    const bg = await seedBackground();
    const creator = await createCreator(db);
    const processing = await seedTake(db, creator.id, { status: "processing" });
    const notReady = await call(deps(creator.id), processing.id, { backgroundId: bg.id });
    expect([notReady.status, notReady.json.error]).toEqual([409, "not_ready"]);

    const pending = await seedBackground({
      status: "processing",
      imageKey: null,
      thumbKey: null,
      width: null,
      height: null,
    });
    const ctx = await readyTake();
    const bgNotReady = await call(deps(ctx.creator.id), ctx.take.id, { backgroundId: pending.id });
    expect([bgNotReady.status, bgNotReady.json.error]).toEqual([409, "background_not_ready"]);

    const expired = await readyTake();
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, expired.take.id));
    const gone = await call(deps(expired.creator.id), expired.take.id, { backgroundId: bg.id });
    expect([gone.status, gone.json.error]).toEqual([409, "original_gone"]);

    const same = await readyTake();
    const sameRes = await call(deps(same.creator.id), same.take.id, { backgroundId: "original" });
    expect([sameRes.status, sameRes.json.error]).toEqual([409, "same_background"]);
    expect(String(sameRes.json.message)).toContain("already has that background");
  });

  it("refuses a real background on a take with no green screen (409 no_green_screen) but not the original path", async () => {
    const bg = await seedBackground();
    const unkeyed = await readyTake({ backgroundId: bg.id, keyed: false });
    const refused = await call(deps(unkeyed.creator.id), unkeyed.take.id, { backgroundId: bg.id });
    expect([refused.status, refused.json.error]).toEqual([409, "no_green_screen"]);
    expect(String(refused.json.message)).toContain("couldn't find a green screen");
    // The original is not refused as no_green_screen (the video is on it already).
    const original = await call(deps(unkeyed.creator.id), unkeyed.take.id, {
      backgroundId: "original",
    });
    expect(original.json.error).not.toBe("no_green_screen");
  });

  it("answers 429 background_change_limit with a friendly message after 10 changes in an hour, and triggers nothing", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    for (let i = 0; i < 10; i += 1) {
      await db.insert(processingJob).values({
        id: crypto.randomUUID(),
        takeId: t.id,
        kind: "background",
        status: "failed",
        failureCode: "internal_error",
        secondsCharged: 0,
      });
    }
    const triggered: string[] = [];
    const res = await call(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect([res.status, res.json.error]).toEqual([429, "background_change_limit"]);
    expect(String(res.json.message)).toContain("changed backgrounds a lot");
    expect(triggered).toEqual([]);
  });
});
