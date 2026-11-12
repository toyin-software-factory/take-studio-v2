import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish, markRunning, startTranscribeJob } from "@/db/data/jobs";
import { background, jobStep, processingJob, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { cancel } from "../jobs";
import { type TakeHttpDeps, handleGet } from "../takes/http";
import {
  type BackgroundHttpDeps,
  TRANSCRIPT_RUNNING_MESSAGE,
  handleChangeBackground,
} from "./http";

const ORIGIN = "https://take-studio.example";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

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

const put = (body: unknown, origin: string | null = ORIGIN) =>
  new Request("https://x.test/api/takes/x/background", {
    method: "PUT",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function call(
  d: BackgroundHttpDeps,
  takeId: string,
  body: unknown,
  origin: string | null = ORIGIN,
) {
  const res = await handleChangeBackground(put(body, origin), takeId, d);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
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
  return row!;
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
      kind: "rerender",
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
        kind: "rerender",
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

  it("says the video is still being made while another job runs, and the transcript wording while a transcript is", async () => {
    const bg = await seedBackground();
    const first = await readyTake();
    expect(
      (await call(deps(first.creator.id), first.take.id, { backgroundId: bg.id })).status,
    ).toBe(202);
    const busy = await call(deps(first.creator.id), first.take.id, { backgroundId: bg.id });
    expect([busy.status, busy.json.error]).toEqual([409, "job_active"]);
    expect(busy.json.message).toBe("Your video is still being made. Try again in a moment.");

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
    const rerender = jobs.find((j) => j.kind === "rerender");
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
    const { creator, take: t } = await readyTake();
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

  it("ignores a re render that trims again (a retry of a failed take) as a background change", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "ready", durationMs: 5_000 });
    const jobId = crypto.randomUUID();
    await db.insert(processingJob).values({
      id: jobId,
      takeId: t.id,
      kind: "rerender",
      status: "failed",
      failureCode: "ffmpeg_error",
      secondsCharged: 0,
    });
    await db.insert(jobStep).values({
      id: crypto.randomUUID(),
      jobId,
      name: "trim",
      position: 0,
      status: "failed",
      progress: 0,
    });
    expect((await get(creator.id, t.id)).backgroundJob).toBeNull();
  });
});

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
