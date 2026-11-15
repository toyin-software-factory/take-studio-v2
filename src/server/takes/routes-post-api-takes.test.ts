import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish } from "@/db/data/jobs";
import { processingJob, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { start } from "../jobs";
import { type TakeHttpDeps, handleGet, handleRetry } from "./http";
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
} /** A take that failed with `code` through the real job path (charged, then refunded if refundable). */
async function failedTake(
  creatorId: string,
  code: "internal_error" | "too_long" | "cancelled_while_running",
) {
  const t = await seedTake(db, creatorId, { status: "uploaded" });
  const job = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  const done = await finish(db, {
    jobId: job.data.id,
    status: code === "cancelled_while_running" ? "cancelled" : "failed",
    failureCode: code,
  });
  if (!done.ok) throw new Error(done.error);
  return t;
}
describe("POST /api/takes/{id}/retry (AC-10, spec 0002)", () => {
  it("starts and dispatches a new run after a non media failure, without a second live charge", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    const triggered: string[] = [];
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, triggered));
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string } };
    expect(triggered).toEqual([job.id]);

    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    expect(jobs).toHaveLength(2);
    // The failed run was refunded, so at most one charge is live at any time.
    const live = jobs.filter((j) => j.secondsCharged > 0 && !j.refunded);
    expect(live.length).toBeLessThanOrEqual(1);
    expect(jobs.find((j) => j.status === "failed")?.refunded).toBe(true);
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.status).toBe("processing");
  });

  it("retries a take that was cancelled while running (not a media failure)", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "cancelled_while_running");
    const [before] = await db.select().from(take).where(eq(take.id, t.id));
    expect(before).toMatchObject({ status: "failed", failureCode: "cancelled_while_running" });
    const triggered: string[] = [];
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, triggered));
    expect(res.status).toBe(202);
    expect(triggered).toHaveLength(1);
  });

  it("refuses a failed take that was never probed (409)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, {
      status: "failed",
      failureCode: "internal_error",
      durationMs: null,
    });
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_retryable");
  });

  it("answers a friendly 503, not a 500, when USAGE_HASH_SECRET is missing, and starts nothing", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    const deps: TakeHttpDeps = {
      ...takeDeps(creator.id),
      usageSecret: () => {
        throw new Error("Invalid usage env: USAGE_HASH_SECRET");
      },
    };
    const res = await handleRetry(req("POST", "/x"), t.id, deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "unavailable",
      message: "Processing isn't available right now. Please try again later.",
    });
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    expect(jobs).toHaveLength(1);
  });

  it("refuses a retry once the video has expired, even before the sweep runs (CodeRabbit #35)", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, t.id));
    const triggered: string[] = [];
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, triggered));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_retryable");
    expect(triggered).toEqual([]);

    const card = await handleGet(req("GET", "/x"), t.id, takeDeps(creator.id));
    const body = (await card.json()) as { take: { retryable: boolean; expired: boolean } };
    expect(body.take).toMatchObject({ expired: true, retryable: false });
  });

  it("refuses media failures with 409, so the page offers 'Upload another video'", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "too_long");
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_retryable");
  });

  it("refuses while a run is in progress (409)", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    const again = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("job_in_progress");
  });

  it("reports 503 when dispatch fails, leaving the take retryable again", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, [], true));
    expect(res.status).toBe(503);
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row).toMatchObject({ status: "failed", failureCode: "trigger_failed" });
  });
});
