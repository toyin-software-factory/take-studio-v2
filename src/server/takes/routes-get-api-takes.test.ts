import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish } from "@/db/data/jobs";
import { cut, jobStep, render } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { start } from "../jobs";
import { type TakeHttpDeps, handleGet, handleRename } from "./http";
import { ORIGIN, SECRET, req } from "./routes-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
function takeDeps(
  creatorId: string | null,
  triggered: string[] = [],
  failTrigger = false,
): TakeHttpDeps {
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    usageSecret: () => SECRET,
    triggerProcessTake: async (jobId) => {
      if (failTrigger) throw new Error("trigger down");
      triggered.push(jobId);
      return { id: `run_${jobId}` };
    },
  };
} /** A ready take with a succeeded job (trim and render steps set) and optionally a render. */
async function readyTake(
  creatorId: string,
  options: {
    title?: string;
    trim?: "succeeded" | "skipped";
    render?: "succeeded";
    ranges?: { startMs: number; endMs: number }[];
  } = {},
) {
  const id = crypto.randomUUID();
  const t = await seedTake(db, creatorId, {
    id,
    status: "uploaded",
    title: options.title ?? "Seeded take",
    container: "mov",
    originalKey: `originals/${id}/source.mov`,
  });
  const job = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  const jobId = job.data.id;
  if (options.render === "succeeded") {
    const renderId = crypto.randomUUID();
    await db.insert(render).values({
      id: renderId,
      takeId: t.id,
      jobId,
      status: "succeeded",
      videoKey: `renders/${t.id}/${renderId}.mp4`,
      durationMs: 50_000,
      removedRanges: options.ranges ?? [],
    });
  }
  // Only this job's steps.
  await db
    .update(jobStep)
    .set({ status: options.trim ?? "succeeded" })
    .where(and(eq(jobStep.jobId, jobId), eq(jobStep.name, "trim")));
  await db
    .update(jobStep)
    .set({ status: options.render === "succeeded" ? "succeeded" : "skipped" })
    .where(and(eq(jobStep.jobId, jobId), eq(jobStep.name, "render")));
  const done = await finish(db, { jobId, status: "succeeded" });
  if (!done.ok) throw new Error(done.error);
  return t;
}
describe("GET /api/takes/{id} (AC-7, AC-8, AC-9)", () => {
  it("returns the take, job with steps, render and removedMs from the render, without storage keys", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, {
      render: "succeeded",
      ranges: [
        { startMs: 1000, endMs: 2400 },
        { startMs: 9000, endMs: 9750 },
      ],
    });
    const res = await handleGet(req("GET", "/x"), t.id, takeDeps(creator.id));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.take).toMatchObject({
      id: t.id,
      status: "ready",
      retryable: false,
      expired: false,
    });
    expect(body.latestJob.steps.map((s: { name: string }) => s.name)).toEqual([
      "trim",
      "transcript",
      "ai_edit",
      "render",
    ]);
    expect(body.latestRender).toMatchObject({ status: "succeeded", durationMs: 50_000 });
    expect(body.removedMs).toBe(2150);
    expect(body.note).toBeNull();
    expect(text).not.toMatch(/originals\/|renders\//);
  });

  it("sums applied cuts when there is no render yet", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    await db.insert(cut).values([
      {
        id: crypto.randomUUID(),
        takeId: t.id,
        startMs: 0,
        endMs: 500,
        kind: "pause",
        proposedBy: "rules",
        applied: true,
      },
      {
        id: crypto.randomUUID(),
        takeId: t.id,
        startMs: 2000,
        endMs: 4000,
        kind: "pause",
        proposedBy: "rules",
        applied: false,
      },
    ]);
    const body = await (await handleGet(req("GET", "/x"), t.id, takeDeps(creator.id))).json();
    expect(body.removedMs).toBe(500);
  });

  it("notes no cuts and no audio (AC-7)", async () => {
    const creator = await createCreator(db);
    const noCuts = await readyTake(creator.id);
    const noAudio = await readyTake(creator.id, { trim: "skipped" });
    expect(
      (await (await handleGet(req("GET", "/x"), noCuts.id, takeDeps(creator.id))).json()).note,
    ).toBe("no_cuts");
    expect(
      (await (await handleGet(req("GET", "/x"), noAudio.id, takeDeps(creator.id))).json()).note,
    ).toBe("no_audio");
  });
});
describe("PATCH /api/takes/{id}", () => {
  it("renames, and rejects an empty or missing title with 422", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const ok = await handleRename(
      req("PATCH", "/x", { title: "  Studio intro  " }),
      t.id,
      takeDeps(creator.id),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).take.title).toBe("Studio intro");
    expect(
      (await handleRename(req("PATCH", "/x", { title: "   " }), t.id, takeDeps(creator.id))).status,
    ).toBe(422);
    expect((await handleRename(req("PATCH", "/x", {}), t.id, takeDeps(creator.id))).status).toBe(
      422,
    );
  });
});
