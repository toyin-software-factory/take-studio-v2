import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cut } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { reanalyse } from "./cuts";
import { finish, markRunning, startTranscribeJob, whileJobActive } from "./jobs";

/** S2T-T07: the writes of a timed out attempt are fenced by the job still being active. */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const proposed = [
  { startMs: 1000, endMs: 2500, kind: "pause" as const, proposedBy: "rules" as const, reason: "x" },
];

async function runningJob() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  const started = await startTranscribeJob(db, { takeId: t.id });
  if (!started.ok) throw new Error("start refused");
  await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
  return { takeId: t.id, jobId: started.data.id };
}

const cutsOf = (takeId: string) => db.select().from(cut).where(eq(cut.takeId, takeId));

describe("whileJobActive", () => {
  it("runs the write and commits it while the job is running", async () => {
    const { takeId, jobId } = await runningJob();
    const result = await whileJobActive(db, jobId, (tx) => reanalyse(tx, { takeId, proposed }));
    expect(result.ok).toBe(true);
    expect(await cutsOf(takeId)).toHaveLength(1);
  });

  it.each(["failed", "cancelled", "succeeded"] as const)(
    "writes nothing once the job was finished %s",
    async (status) => {
      const { takeId, jobId } = await runningJob();
      await finish(
        db,
        status === "succeeded"
          ? { jobId, status }
          : {
              jobId,
              status,
              failureCode: status === "failed" ? "timeout" : "cancelled_while_running",
            },
      );
      const result = await whileJobActive(db, jobId, (tx) => reanalyse(tx, { takeId, proposed }));
      expect(result).toEqual({ ok: false, error: "job_final" });
      expect(await cutsOf(takeId)).toHaveLength(0);
    },
  );

  it("rolls the write back when the callback fails, and says job_final for an unknown job", async () => {
    const { takeId, jobId } = await runningJob();
    const failed = await whileJobActive(db, jobId, async (tx) => {
      await reanalyse(tx, { takeId, proposed });
      return { ok: false as const, error: "nope" as const };
    });
    expect(failed).toEqual({ ok: false, error: "nope" });
    expect(await cutsOf(takeId)).toHaveLength(0);
    const unknown = await whileJobActive(db, crypto.randomUUID(), async () => ({
      ok: true as const,
      data: 1,
    }));
    expect(unknown).toEqual({ ok: false, error: "job_final" });
  });
});
