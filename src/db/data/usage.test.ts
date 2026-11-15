import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { usageAccountHash } from "@/lib/usage-hash";
import { appSetting, processingJob, take, usageMonth, user } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { finish, startJob } from "./jobs";
import { getUsedSeconds, readUsageSettings } from "./usage";
import { MONTH, NOW, SECRET } from "./usage-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_usage" });
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
const jobOf = async (takeId: string) => {
  const [row] = await db.select().from(processingJob).where(eq(processingJob.takeId, takeId));
  if (!row) throw new Error("no job");
  return row;
};
describe("charge at start", () => {
  it("records the charge but refuses nothing while the limit is off", async () => {
    await setSettings(false, 100);
    const a = await account();
    const t = await a.makeTake(500);
    expect((await a.start(t.id)).ok).toBe(true);
    expect(await used(a.hash)).toBe(500);
    expect((await jobOf(t.id)).usageCounted).toBe(true);
  });

  it("passes an exact fit and refuses one second over, leaving nothing behind", async () => {
    const a = await account();
    const fit = await a.makeTake(100);
    expect((await a.start(fit.id)).ok).toBe(true);
    expect(await used(a.hash)).toBe(100);

    const b = await account();
    const first = await b.makeTake(60);
    await b.start(first.id);
    const over = await b.makeTake(41);
    expect(await b.start(over.id)).toEqual({ ok: false, error: "limit_exceeded" });
    expect(await used(b.hash)).toBe(60);
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, over.id));
    expect(jobs).toHaveLength(0);
    const [after] = await db.select().from(take).where(eq(take.id, over.id));
    expect(after?.status).toBe("uploaded");
  });

  it("creates no row when the first charge is larger than the allowance", async () => {
    const a = await account();
    const t = await a.makeTake(101);
    expect(await a.start(t.id)).toEqual({ ok: false, error: "limit_exceeded" });
    const rows = await db.select().from(usageMonth).where(eq(usageMonth.accountHash, a.hash));
    expect(rows).toHaveLength(0);
  });

  it("lets exactly one of two parallel starts win when there is room for one", async () => {
    const a = await account();
    const [t1, t2] = await Promise.all([a.makeTake(70), a.makeTake(70)]);
    const results = await Promise.all([a.start(t1!.id), a.start(t2!.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(await used(a.hash)).toBe(70);
  });

  it("puts a +tag address on the same account and a new month on a new row", async () => {
    const name = `same-${crypto.randomUUID().slice(0, 8)}`;
    const plain = await account(`${name}@example.com`);
    const tagged = await account(`${name}+promo@example.com`);
    expect(tagged.hash).toBe(plain.hash);
    await plain.start((await plain.makeTake(30)).id);
    await tagged.start((await tagged.makeTake(30)).id);
    expect(await used(plain.hash)).toBe(60);

    const later = new Date("2026-12-01T00:00:00Z");
    await plain.start((await plain.makeTake(30)).id, later);
    expect(await used(plain.hash, "2026-12-01")).toBe(30);
    expect(await used(plain.hash)).toBe(60);
  });

  it("charges 0 on a retry while an earlier charge stands", async () => {
    const a = await account();
    const t = await a.makeTake(40);
    const first = await a.start(t.id);
    if (!first.ok) throw new Error("refused");
    await finish(db, { jobId: first.data.id, status: "failed", failureCode: "provider_rejected" });
    const second = await a.start(t.id);
    expect(second.ok).toBe(true);
    expect(await used(a.hash)).toBe(40);
  });
});
describe("refund", () => {
  it("returns the seconds once, then the retry charges again", async () => {
    const a = await account();
    const t = await a.makeTake(40);
    const first = await a.start(t.id);
    if (!first.ok) throw new Error("refused");
    await finish(db, { jobId: first.data.id, status: "failed", failureCode: "timeout" });
    expect(await used(a.hash)).toBe(0);
    expect((await jobOf(t.id)).usageReturned).toBe(true);
    // A second finish cannot return it again.
    await finish(db, { jobId: first.data.id, status: "failed", failureCode: "timeout" });
    expect(await used(a.hash)).toBe(0);

    expect((await a.start(t.id)).ok).toBe(true);
    expect(await used(a.hash)).toBe(40);
  });

  it("returns to the charged month and never goes below 0", async () => {
    const a = await account();
    const t = await a.makeTake(40);
    const first = await a.start(t.id);
    if (!first.ok) throw new Error("refused");
    await db.update(usageMonth).set({ secondsUsed: 10 }).where(eq(usageMonth.accountHash, a.hash));
    await finish(db, { jobId: first.data.id, status: "failed", failureCode: "timeout" });
    expect(await used(a.hash)).toBe(0);
  });

  it("keeps the charge for a failure that is not refundable", async () => {
    const a = await account();
    const t = await a.makeTake(40);
    const first = await a.start(t.id);
    if (!first.ok) throw new Error("refused");
    await finish(db, { jobId: first.data.id, status: "failed", failureCode: "provider_rejected" });
    expect(await used(a.hash)).toBe(40);
  });

  it("keeps usage after the take and the account are deleted", async () => {
    const a = await account();
    const t = await a.makeTake(40);
    await a.start(t.id);
    await db.delete(take).where(eq(take.id, t.id));
    expect(await used(a.hash)).toBe(40);
    await db.delete(user).where(eq(user.id, a.creator.id));
    expect(await used(a.hash)).toBe(40);
  });
});
describe("settings", () => {
  it("reads the seeded defaults shape and a changed value", async () => {
    await setSettings(true, 123);
    expect(await readUsageSettings(db)).toEqual({ freeMonthlySeconds: 123, limitEnabled: true });
  });
});
