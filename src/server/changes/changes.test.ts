import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reanalyse } from "@/db/data/cuts";
import { analyticsEvent, cut, processingJob, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type TakeHttpDeps, handleGet } from "../takes/http";
import { type ChangesHttpDeps, handleChanges, handleJobStatus, handleWaveform } from "./http";

const ORIGIN = "https://take-studio.example";
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const A = { startMs: 1000, endMs: 2000 };
const B = { startMs: 5000, endMs: 6000 };

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

async function post(
  d: ChangesHttpDeps,
  takeId: string,
  body: unknown,
  origin: string | null = ORIGIN,
) {
  const res = await handleChanges(
    new Request("https://x.test/api/takes/x/changes", {
      method: "POST",
      headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    takeId,
    d,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** The recorded events of one name for a creator (spec 0016). */
const eventsOf = (db: Db, creatorId: string, name: string) =>
  db
    .select()
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.creatorId, creatorId), eq(analyticsEvent.name, name)));

describe("POST /api/takes/[id]/changes (spec 0011)", () => {
  it("starts one free job with the cut plan and triggers it (202)", async () => {
    const ctx = await readyTake();
    const triggered: string[] = [];
    const res = await post(deps(ctx.creator.id, triggered), ctx.take.id, {
      baseRenderId: ctx.renderId,
      cuts: [{ id: ctx.cutA, applied: false }],
    });
    expect(res.status).toBe(202);
    const [job] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, res.json.jobId as string));
    expect(job).toMatchObject({
      kind: "background",
      status: "queued",
      secondsCharged: 0,
      cutPlan: [{ cutId: ctx.cutA, applied: false }],
    });
    expect(triggered).toEqual([job!.id]);
    const [row] = await db.select().from(take).where(eq(take.id, ctx.take.id));
    expect(row?.status).toBe("ready");
    // Spec 0016 AC-4: one change request event, with the take ID and nothing else.
    const events = await eventsOf(db, ctx.creator.id, "change_requested");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ takeId: ctx.take.id, props: {} });
  });

  it("checks Origin (403), session (401), then the body (422)", async () => {
    const ctx = await readyTake();
    const ok = { baseRenderId: ctx.renderId, cuts: [{ id: ctx.cutA, applied: false }] };
    expect((await post(deps(ctx.creator.id), ctx.take.id, ok, null)).status).toBe(403);
    expect((await post(deps(null), ctx.take.id, ok)).status).toBe(401);
    for (const bad of [
      {},
      { baseRenderId: "x" },
      null,
      { baseRenderId: ctx.renderId, cuts: [{ id: ctx.cutA, applied: "no" }] },
    ]) {
      expect((await post(deps(ctx.creator.id), ctx.take.id, bad)).status).toBe(422);
    }
  });

  it("maps the refusals: stale 409, nothing_changed 409, change_limit 429, job_active 409", async () => {
    const ctx = await readyTake();
    const d = deps(ctx.creator.id);
    const plan = [{ id: ctx.cutA, applied: false }];
    expect(
      (await post(d, ctx.take.id, { baseRenderId: crypto.randomUUID(), cuts: plan })).json.error,
    ).toBe("stale");
    const empty = await post(d, ctx.take.id, { baseRenderId: ctx.renderId });
    expect([empty.status, empty.json.error]).toEqual([409, "nothing_changed"]);
    const first = await post(d, ctx.take.id, { baseRenderId: ctx.renderId, cuts: plan });
    expect(first.status).toBe(202);
    const again = await post(d, ctx.take.id, { baseRenderId: ctx.renderId, cuts: plan });
    expect([again.status, again.json.error]).toEqual([409, "job_active"]);
    const busy = await readyTake();
    for (let i = 0; i < 10; i += 1) {
      await db.insert(processingJob).values({
        id: crypto.randomUUID(),
        takeId: busy.take.id,
        kind: "background",
        status: "failed",
        failureCode: "internal_error",
        secondsCharged: 0,
      });
    }
    const limited = await post(deps(busy.creator.id), busy.take.id, {
      baseRenderId: busy.renderId,
      cuts: [{ id: busy.cutA, applied: false }],
    });
    expect([limited.status, limited.json.error]).toEqual([429, "change_limit"]);
  });

  it("answers 404 for another creator's take and cut", async () => {
    const ctx = await readyTake();
    const other = await readyTake();
    const stranger = deps(other.creator.id);
    expect(
      (
        await post(stranger, ctx.take.id, {
          baseRenderId: ctx.renderId,
          cuts: [{ id: ctx.cutA, applied: false }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post(stranger, other.take.id, {
          baseRenderId: other.renderId,
          cuts: [{ id: ctx.cutA, applied: false }],
        })
      ).status,
    ).toBe(404);
  });

  it("a trigger that throws gives 503 and the job is finished", async () => {
    const ctx = await readyTake();
    const res = await post(deps(ctx.creator.id, [], true), ctx.take.id, {
      baseRenderId: ctx.renderId,
      cuts: [{ id: ctx.cutA, applied: false }],
    });
    expect(res.status).toBe(503);
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, ctx.take.id));
    expect(jobs.filter((j) => j.kind === "background").map((j) => j.status)).toEqual(["failed"]);
  });
});

describe("POST /changes on a take with no render", () => {
  it("accepts baseRenderId null as the expected no render state, and refuses it as stale otherwise", async () => {
    const ctx = await readyTake();
    await db.delete(render).where(eq(render.takeId, ctx.take.id));
    const plan = [{ id: ctx.cutA, applied: false }];
    const bad = await post(deps(ctx.creator.id), ctx.take.id, {
      baseRenderId: crypto.randomUUID(),
      cuts: plan,
    });
    expect([bad.status, bad.json.error]).toEqual([409, "stale"]);
    const ok = await post(deps(ctx.creator.id), ctx.take.id, { baseRenderId: null, cuts: plan });
    expect(ok.status).toBe(202);
    const withRender = await readyTake();
    const stale = await post(deps(withRender.creator.id), withRender.take.id, {
      baseRenderId: null,
      cuts: [{ id: withRender.cutA, applied: false }],
    });
    expect([stale.status, stale.json.error]).toEqual([409, "stale"]);
  });
});

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
