import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { usageAccountHash } from "@/lib/usage-hash";
import { appSetting, processingJob, usageMonth } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { finish, startJob } from "./jobs";
import { getUsedSeconds, readUsageSettings } from "./usage";
import { enableUsageLimit, reconcileUsage } from "./usage-reconcile";
import { MONTH, NOW, SECRET } from "./usage-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_usage_2" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
async function setSettings(enabled: boolean, seconds = 100): Promise<void> {
  const rows = [
    { key: "usage_limit_enabled", value: enabled },
    { key: "free_monthly_seconds", value: seconds },
  ];
  for (const row of rows) {
    await db
      .insert(appSetting)
      .values(row)
      .onConflictDoUpdate({ target: appSetting.key, set: { value: row.value } });
  }
}
beforeEach(() =>
  setSettings(true, 100),
); /** A creator with a take of `seconds` seconds, plus the account's usage hash. */
async function account(email?: string) {
  const creator = await createCreator(db, email);
  const hash = await usageAccountHash(creator.email, SECRET);
  const makeTake = (seconds: number) =>
    seedTake(db, creator.id, { durationMs: seconds * 1000, status: "uploaded" });
  const start = (takeId: string, now = NOW) =>
    startJob(db, { creatorId: creator.id, takeId, usageSecret: SECRET, now });
  return { creator, hash, makeTake, start };
}
const used = (hash: string, month = MONTH) => getUsedSeconds(db, { accountHash: hash, month });
describe("backfill and reconcile (AC-11)", () => {
  /** Puts a started job back in the state it had before the migration. */
  async function uncount(takeId: string, hash: string): Promise<void> {
    await db
      .update(processingJob)
      .set({ usageCounted: false })
      .where(eq(processingJob.takeId, takeId));
    await db.delete(usageMonth).where(eq(usageMonth.accountHash, hash));
  }

  it("enableUsageLimit switches the setting on, from off or from a missing row, and is safe to repeat", async () => {
    await setSettings(false);
    expect((await readUsageSettings(db)).limitEnabled).toBe(false);
    await enableUsageLimit(db);
    await enableUsageLimit(db);
    expect((await readUsageSettings(db)).limitEnabled).toBe(true);
    await db.delete(appSetting).where(eq(appSetting.key, "usage_limit_enabled"));
    await enableUsageLimit(db);
    expect((await readUsageSettings(db)).limitEnabled).toBe(true);
  });

  it("the migration backfill counts old jobs once and is safe to run twice", async () => {
    await setSettings(false);
    const a = await account();
    const t1 = await a.makeTake(30);
    const t2 = await a.makeTake(20);
    await a.start(t1.id);
    await a.start(t2.id);
    await db
      .update(processingJob)
      .set({ usageCounted: false })
      .where(inArray(processingJob.takeId, [t1.id, t2.id]));
    await db.delete(usageMonth).where(eq(usageMonth.accountHash, a.hash));

    const file = readFileSync(
      new URL("../../../drizzle/0011_usage_month.sql", import.meta.url),
      "utf8",
    );
    const backfill = file.split("--> statement-breakpoint").find((s) => s.includes("WITH counted"));
    if (!backfill) throw new Error("backfill statement not found");
    await db.execute(sql.raw(backfill));
    expect(await used(a.hash)).toBe(50);
    await db.execute(sql.raw(backfill));
    expect(await used(a.hash)).toBe(50);
  });

  it("adds a charged, uncounted job and a second run finds nothing", async () => {
    await setSettings(false);
    const a = await account();
    const t = await a.makeTake(45);
    await a.start(t.id);
    await uncount(t.id, a.hash);
    const first = await reconcileUsage(db);
    expect(first.added).toBeGreaterThanOrEqual(45);
    expect(await used(a.hash)).toBe(45);
    const second = await reconcileUsage(db);
    expect(second).toEqual({ added: 0, subtracted: 0, jobs: 0, failed: 0 });
    expect(await used(a.hash)).toBe(45);
  });

  it("counts a job whose transaction throws as failed and leaves it owed", async () => {
    await setSettings(false);
    const a = await account();
    const t = await a.makeTake(30);
    await a.start(t.id);
    await uncount(t.id, a.hash);
    const broken = new Proxy(db, {
      get: (target, key, receiver) =>
        key === "transaction"
          ? () => Promise.reject(new Error("connection lost"))
          : Reflect.get(target, key, receiver),
    });
    const failedRun = await reconcileUsage(broken);
    expect(failedRun.failed).toBeGreaterThanOrEqual(1);
    expect(failedRun.jobs).toBe(0);
    expect(await used(a.hash)).toBe(0);
    const retry = await reconcileUsage(db);
    expect(retry.failed).toBe(0);
    expect(await used(a.hash)).toBe(30);
  });

  it("never adds a refunded job, and subtracts one refunded after it was counted", async () => {
    await setSettings(false);
    const a = await account();
    const refundedFirst = await a.makeTake(25);
    const started = await a.start(refundedFirst.id);
    if (!started.ok) throw new Error("refused");
    await finish(db, { jobId: started.data.id, status: "failed", failureCode: "timeout" });
    await db
      .update(processingJob)
      .set({ usageCounted: false, usageReturned: false })
      .where(eq(processingJob.takeId, refundedFirst.id));
    await reconcileUsage(db);
    expect(await used(a.hash)).toBe(0);

    // Old code refunded a counted job without returning the seconds.
    const b = await account();
    const t = await b.makeTake(25);
    const s = await b.start(t.id);
    if (!s.ok) throw new Error("refused");
    await db
      .update(processingJob)
      .set({ refunded: true, usageReturned: false })
      .where(and(eq(processingJob.takeId, t.id)));
    expect(await used(b.hash)).toBe(25);
    const result = await reconcileUsage(db);
    expect(result.subtracted).toBeGreaterThanOrEqual(25);
    expect(await used(b.hash)).toBe(0);
  });
});
