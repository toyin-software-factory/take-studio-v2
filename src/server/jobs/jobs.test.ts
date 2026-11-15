import { createHmac } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingJob, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { startJob } from "@/db/data/jobs";
import { cancel, finish, markRunning, start } from ".";
import { NOW, SECRET } from "./jobs-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
async function startOk(creatorId: string, takeId: string) {
  const result = await start(db, { creatorId, takeId, usageSecret: SECRET, now: NOW });
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.data;
} /** Inserts a render for a job the way the render step will (FDM-T03 owns its functions). */
async function seedRender(
  takeId: string,
  jobId: string,
  values: Partial<typeof render.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await db.insert(render).values({
    id,
    takeId,
    jobId,
    status: "succeeded",
    videoKey: `renders/${takeId}/${id}.mp4`,
    removedRanges: [],
    ...values,
  });
  return id;
}
async function takeRow(id: string) {
  const [row] = await db.select().from(take).where(eq(take.id, id));
  return row;
}
describe("jobs.start (AC-6, AC-7)", () => {
  it("starts an initial job: charges the length, records month and account hash, creates live steps", async () => {
    const creator = await createCreator(db, `Ada.Love+yt.${crypto.randomUUID()}@GoogleMail.com`);
    const t = await seedTake(db, creator.id, { durationMs: 61_500 });

    const job = await startOk(creator.id, t.id);

    const canonical = creator.email
      .toLowerCase()
      .replace(/\+.*@/, "@")
      .replace("googlemail", "gmail");
    const [local, domain] = canonical.split("@");
    const expectedHash = createHmac("sha256", SECRET)
      .update(`${local?.replaceAll(".", "")}@${domain}`)
      .digest("hex");
    expect(job).toMatchObject({
      kind: "initial",
      status: "queued",
      secondsCharged: 62,
      chargedMonth: "2026-11-01",
      chargedAccountHash: expectedHash,
      refunded: false,
    });
    expect(job.steps.map((s) => [s.name, s.position, s.status, s.progress])).toEqual([
      ["trim", 0, "pending", 0],
      ["transcript", 1, "pending", 0],
      ["ai_edit", 2, "pending", 0],
      ["render", 3, "pending", 0],
    ]);
    expect((await takeRow(t.id))?.status).toBe("processing");
  });

  it("gives job_in_progress to the loser of two simultaneous starts, with one charge (AC-4)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);

    const results = await Promise.all([
      start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET }),
      start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "job_in_progress" }]);
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    expect(jobs).toHaveLength(1);
    expect(jobs.reduce((sum, j) => sum + j.secondsCharged, 0)).toBe(62);
  });

  it("refuses takes that can't start: not probed, still uploading, expired", async () => {
    const creator = await createCreator(db);
    for (const overrides of [
      { status: "uploading" as const, durationMs: null },
      { status: "failed" as const, durationMs: null },
      { status: "expired" as const },
    ]) {
      const t = await seedTake(db, creator.id, overrides);
      expect(await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET })).toEqual(
        { ok: false, error: "invalid_transition" },
      );
    }
    const jobs = await db
      .select({ id: processingJob.id })
      .from(processingJob)
      .innerJoin(take, eq(take.id, processingJob.takeId))
      .where(eq(take.creatorId, creator.id));
    expect(jobs).toEqual([]);
  });

  it("never restarts a take that failed because of its media, even with a known length (AC-10)", async () => {
    const creator = await createCreator(db);
    for (const failureCode of [
      "too_long",
      "resolution_exceeded",
      "invalid_media",
      "corrupt_upload",
    ]) {
      const t = await seedTake(db, creator.id, {
        status: "failed",
        failureCode,
        durationMs: 660_000,
      });
      expect(
        await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET }),
        failureCode,
      ).toEqual({ ok: false, error: "invalid_transition" });
    }
  });

  it("retries a take whose failure was not the media's fault", async () => {
    const creator = await createCreator(db);
    for (const failureCode of ["timeout", "ffmpeg_error", "cancelled_while_running"]) {
      const t = await seedTake(db, creator.id, { status: "failed", failureCode });
      const retried = await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET });
      expect(retried.ok, failureCode).toBe(true);
    }
  });

  it("refuses a failed take whose video has expired, and still starts one that has not", async () => {
    const creator = await createCreator(db);
    const base = { status: "failed" as const, failureCode: "timeout" };
    const gone = await seedTake(db, creator.id, {
      ...base,
      videoExpiresAt: new Date(NOW.getTime() - 1000),
    });
    const atNow = await seedTake(db, creator.id, { ...base, videoExpiresAt: NOW });
    const fresh = await seedTake(db, creator.id, {
      ...base,
      videoExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    const startAt = (takeId: string) =>
      start(db, { creatorId: creator.id, takeId, usageSecret: SECRET, now: NOW });
    expect(await startAt(gone.id)).toEqual({ ok: false, error: "invalid_transition" });
    expect(await startAt(atNow.id)).toEqual({ ok: false, error: "invalid_transition" });
    expect((await startAt(fresh.id)).ok).toBe(true);
    const rows = await db
      .select()
      .from(processingJob)
      .where(inArray(processingJob.takeId, [gone.id, atNow.id]));
    expect(rows).toEqual([]);
  });

  it("lets a caller restrict which take statuses may start (the probe: uploaded only)", async () => {
    const creator = await createCreator(db);
    const ready = await seedTake(db, creator.id, { status: "ready" });
    expect(
      await startJob(db, {
        creatorId: creator.id,
        takeId: ready.id,
        usageSecret: SECRET,
        fromStatuses: ["uploaded"],
      }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    const uploaded = await seedTake(db, creator.id, { status: "uploaded" });
    const started = await startJob(db, {
      creatorId: creator.id,
      takeId: uploaded.id,
      usageSecret: SECRET,
      fromStatuses: ["uploaded"],
    });
    expect(started.ok).toBe(true);
  });

  it("re renders for free once an initial job succeeded", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const first = await startOk(creator.id, t.id);
    await seedRender(t.id, first.id);
    expect((await finish(db, { jobId: first.id, status: "succeeded" })).ok).toBe(true);

    const rerender = await startOk(creator.id, t.id);
    expect(rerender).toMatchObject({
      kind: "rerender",
      secondsCharged: 0,
      chargedMonth: null,
      chargedAccountHash: null,
    });
    expect(rerender.steps.map((s) => s.name)).toEqual(["trim", "transcript", "ai_edit", "render"]);
  });

  it("does not charge a retry after a non refundable failure, but does after a refunded one", async () => {
    const creator = await createCreator(db);
    const paid = await seedTake(db, creator.id);
    const j1 = await startOk(creator.id, paid.id);
    await markRunning(db, { jobId: j1.id, triggerRunId: "run_1" });
    await cancel(db, { creatorId: creator.id, jobId: j1.id }); // cancelled_while_running: kept
    expect((await startOk(creator.id, paid.id)).secondsCharged).toBe(0);

    const refunded = await seedTake(db, creator.id);
    const j2 = await startOk(creator.id, refunded.id);
    await finish(db, { jobId: j2.id, status: "failed", failureCode: "ffmpeg_error" });
    expect((await startOk(creator.id, refunded.id)).secondsCharged).toBe(62);
  });
});
