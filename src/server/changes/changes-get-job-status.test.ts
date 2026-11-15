import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reanalyse } from "@/db/data/cuts";
import { cut, processingJob, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type TakeHttpDeps, handleGet } from "../takes/http";
import { type ChangesHttpDeps, handleJobStatus, handleWaveform } from "./http";
import { A, B, ORIGIN, post } from "./changes-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_changes_get_job_status" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
async function readyTake() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  const [cutA, cutB] = [crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(cut).values([
    { id: cutA, takeId: t.id, ...A, kind: "pause", proposedBy: "rules" },
    { id: cutB, takeId: t.id, ...B, kind: "pause", proposedBy: "rules" },
  ]);
  const jobId = crypto.randomUUID();
  await db.insert(processingJob).values({
    id: jobId,
    takeId: t.id,
    kind: "initial",
    status: "succeeded",
    secondsCharged: 10,
  });
  const renderId = crypto.randomUUID();
  await db.insert(render).values({
    id: renderId,
    takeId: t.id,
    jobId,
    status: "succeeded",
    videoKey: `renders/${t.id}/${renderId}.mp4`,
    durationMs: 8_000,
    removedRanges: [A, B],
    isLatest: true,
  });
  return { creator, take: t, renderId, cutA, cutB };
}
function deps(creatorId: string | null, triggered: string[] = [], fail = false): ChangesHttpDeps {
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    triggerProcessTake: async (jobId) => {
      if (fail) throw new Error("trigger down");
      triggered.push(jobId);
      return { id: `run_${jobId}` };
    },
  };
}
describe("GET job status and waveform", () => {
  const get = (url: string) => new Request(url);

  it("returns the status to the owner only", async () => {
    const ctx = await readyTake();
    const other = await readyTake();
    const [job] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.takeId, ctx.take.id));
    const ok = await handleJobStatus(
      get("https://x.test/j"),
      ctx.take.id,
      job!.id,
      deps(ctx.creator.id),
    );
    expect([ok.status, await ok.json()]).toEqual([200, { status: "succeeded" }]);
    for (const [takeId, jobId, who] of [
      [ctx.take.id, job!.id, other.creator.id],
      [other.take.id, job!.id, other.creator.id],
      [ctx.take.id, crypto.randomUUID(), ctx.creator.id],
    ] as const) {
      expect(
        (await handleJobStatus(get("https://x.test/j"), takeId, jobId, deps(who))).status,
      ).toBe(404);
    }
    expect(
      (await handleJobStatus(get("https://x.test/j"), ctx.take.id, job!.id, deps(null))).status,
    ).toBe(401);
  });

  it("returns the stored waveform, null before it is computed, 404 for others", async () => {
    const ctx = await readyTake();
    const read = async (who: string) =>
      handleWaveform(get("https://x.test/w"), ctx.take.id, deps(who));
    expect(await (await read(ctx.creator.id)).json()).toEqual({ waveform: null });
    await db
      .update(take)
      .set({ waveform: [0, 3, 7] })
      .where(eq(take.id, ctx.take.id));
    expect(await (await read(ctx.creator.id)).json()).toEqual({ waveform: [0, 3, 7] });
    expect((await read((await readyTake()).creator.id)).status).toBe(404);
  });
});
describe("GET /api/takes/[id] cut review fields and re-analysis", () => {
  const takeDeps = (creatorId: string): TakeHttpDeps => ({
    allowedOrigin: ORIGIN,
    getCreator: async () => ({ db, creatorId }),
    usageSecret: () => "x".repeat(40),
    triggerProcessTake: async () => ({ id: "run" }),
  });
  const read = async (creatorId: string, takeId: string) =>
    (await (
      await handleGet(new Request("https://x.test/t"), takeId, takeDeps(creatorId))
    ).json()) as {
      cuts: { id: string; startMs: number; endMs: number; kind: string; applied: boolean }[];
      originalAvailable: boolean;
      latestRender: { removedRanges: { startMs: number; endMs: number }[] };
    };

  it("lists cuts, originalAvailable and the render's removed ranges", async () => {
    const ctx = await readyTake();
    const body = await read(ctx.creator.id, ctx.take.id);
    expect(body.cuts.map((c) => [c.id, c.applied]).sort()).toEqual(
      [
        [ctx.cutA, true],
        [ctx.cutB, true],
      ].sort(),
    );
    expect(body.originalAvailable).toBe(true);
    expect(body.latestRender.removedRanges).toEqual([A, B]);
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, ctx.take.id));
    expect((await read(ctx.creator.id, ctx.take.id)).originalAvailable).toBe(false);
  });

  it("re-analysis keeps a cut the creator restored", async () => {
    const ctx = await readyTake();
    const res = await post(deps(ctx.creator.id), ctx.take.id, {
      baseRenderId: ctx.renderId,
      cuts: [{ id: ctx.cutA, applied: false }],
    });
    const jobId = res.json.jobId as string;
    // Stand in for the worker: the plan lands as the creator's choice.
    await db
      .update(cut)
      .set({ applied: false, creatorChangedAt: new Date() })
      .where(eq(cut.id, ctx.cutA));
    await db.update(processingJob).set({ status: "succeeded" }).where(eq(processingJob.id, jobId));
    const out = await reanalyse(db, { takeId: ctx.take.id, proposed: [] });
    expect(out.ok).toBe(true);
    const kept = (await db.select().from(cut).where(eq(cut.takeId, ctx.take.id))).map((c) => c.id);
    expect(kept).toContain(ctx.cutA);
    expect(kept).not.toContain(ctx.cutB);
  });
});
