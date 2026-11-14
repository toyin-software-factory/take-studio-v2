import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appSetting, processingJob, take, usageMonth } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { chargedMonth } from "@/lib/billing";
import { usageAccountHash } from "@/lib/usage-hash";
import { startAndDispatch } from "./probe";

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
});
