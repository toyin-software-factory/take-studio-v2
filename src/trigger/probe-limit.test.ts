import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { analyticsEvent, appSetting, processingJob, take, usageMonth } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { chargedMonth } from "@/lib/billing";
import { usageAccountHash } from "@/lib/usage-hash";
import { dispatchJob } from "@/db/data/dispatch";
import { startJob } from "@/db/data/jobs";
import { startAndDispatch } from "./probe";

// The trigger is replaced so no real run starts; `failTrigger` makes it throw (dispatch fails).
const trigger = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/trigger-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trigger-runs")>()),
  triggerForJob: () => async () => {
    if (trigger.fail) throw new Error("trigger down");
    return { id: "run_test" };
  },
}));

/** Spec 0014 AC-6, AC-13: the probe ends a refused first charge as failed `limit_exceeded`. */
const SECRET = "x".repeat(40);
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_probe_limit" });
  db = testDb.db;
  for (const row of [
    { key: "usage_limit_enabled", value: true },
    { key: "free_monthly_seconds", value: 100 },
  ]) {
    await db
      .insert(appSetting)
      .values(row)
      .onConflictDoUpdate({ target: appSetting.key, set: { value: row.value } });
  }
});
afterAll(() => testDb?.close());

describe("probe ending at the limit", () => {
  const a = async () => {
    const creator = await createCreator(db);
    const hash = await usageAccountHash(creator.email, SECRET);
    await db.insert(usageMonth).values({
      accountHash: hash,
      month: chargedMonth(new Date()),
      secondsUsed: 80,
      hashVersion: 1,
    });
    return { creator, hash };
  };

  it("moves an uploaded take to failed limit_exceeded: no job, nothing charged, original kept", async () => {
    const x = await a();
    const t = await seedTake(db, x.creator.id, { durationMs: 30_000, status: "uploaded" });
    const out = await startAndDispatch(db, t.id, x.creator.id, SECRET);
    expect(out).toEqual({ takeId: t.id, outcome: "limit_exceeded" });
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("limit_exceeded");
    expect(row?.originalKey).toBe(t.originalKey);
    expect(
      await db.select().from(processingJob).where(eq(processingJob.takeId, t.id)),
    ).toHaveLength(0);
    const [m] = await db.select().from(usageMonth).where(eq(usageMonth.accountHash, x.hash));
    expect(m?.secondsUsed).toBe(80);
  });

  it("records take_failed trigger_failed when the dispatch fails (CodeRabbit, #221)", async () => {
    trigger.fail = true;
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { durationMs: 5_000, status: "uploaded" });
    const out = await startAndDispatch(db, t.id, creator.id, SECRET);
    expect(out).toMatchObject({ outcome: "started", dispatched: false });
    trigger.fail = false;
    const events = await db.select().from(analyticsEvent).where(eq(analyticsEvent.takeId, t.id));
    expect(events.map((e) => [e.name, e.props])).toEqual([
      ["take_failed", { code: "trigger_failed" }],
    ]);
  });

  it("a dispatch that fails on a job another call already failed is not this call's failure (CodeRabbit, #221)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { durationMs: 5_000, status: "uploaded" });
    const started = await startJob(db, {
      creatorId: creator.id,
      takeId: t.id,
      usageSecret: SECRET,
      fromStatuses: ["uploaded"],
    });
    if (!started.ok) throw new Error(started.error);
    const throwing = async () => {
      throw new Error("trigger down");
    };
    const first = await dispatchJob(db, { jobId: started.data.id, trigger: throwing });
    const second = await dispatchJob(db, { jobId: started.data.id, trigger: throwing });
    expect(first).toEqual({ ok: false, error: "trigger_failed" });
    expect(second).toEqual({ ok: false, error: "trigger_failed_already_final" });
  });
});
