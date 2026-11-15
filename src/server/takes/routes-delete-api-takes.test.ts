import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish } from "@/db/data/jobs";
import { jobStep, render, storageDeletion, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { start } from "../jobs";
import { type TakeHttpDeps, handleDelete } from "./http";
import { NOT_FOUND, ORIGIN, SECRET, req } from "./routes-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_routes_delete_api_takes" });
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
describe("DELETE /api/takes/{id} (spec 0013 AC-3, AC-6)", () => {
  const noopAfter = { cancelRuns: async () => {}, requestStorageDrain: async () => {} };
  const depsWith = (creatorId: string | null, afterDelete = noopAfter): TakeHttpDeps => ({
    ...takeDeps(creatorId),
    afterDelete,
  });

  it("answers 403 for a missing or foreign Origin and deletes nothing", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    for (const origin of ["https://evil.example", null]) {
      const res = await handleDelete(
        req("DELETE", "/x", undefined, origin),
        t.id,
        depsWith(creator.id),
      );
      expect(res.status).toBe(403);
    }
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toHaveLength(1);
  });

  it("answers 204 with no body, removes the take and queues its original, then 404 on a repeat", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, { render: "succeeded" });
    const res = await handleDelete(req("DELETE", "/x"), t.id, depsWith(creator.id));
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toEqual([]);
    const queued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(eq(storageDeletion.objectKey, t.originalKey));
    expect(queued).toHaveLength(1);

    const again = await handleDelete(req("DELETE", "/x"), t.id, depsWith(creator.id));
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual(NOT_FOUND);
  });

  it("leaves another creator's take alone and gives the same 404", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await seedTake(db, owner.id);
    for (const id of [t.id, "not-a-uuid", crypto.randomUUID()]) {
      const res = await handleDelete(req("DELETE", "/x"), id, depsWith(other.id));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toHaveLength(1);
  });

  it("still answers 204 when the cancel or the drain request fails after the commit", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const failing = {
      cancelRuns: async () => {
        throw new Error("trigger down");
      },
      requestStorageDrain: async () => {
        throw new Error("trigger down");
      },
    };
    const res = await handleDelete(req("DELETE", "/x"), t.id, depsWith(creator.id, failing));
    expect(res.status).toBe(204);
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toEqual([]);
  });
});
