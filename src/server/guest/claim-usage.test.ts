import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { finish, startJob } from "@/db/data/jobs";
import { getUsedSeconds } from "@/db/data/usage";
import { MONTH, NOW, SECRET } from "@/db/data/usage-test-helpers";
import { appSetting, guestClaim, processingJob, take, usageMonth } from "@/db/schema";
import { type TestDb, openTestDb, seedTake } from "@/db/testing/test-db";
import { usageAccountHash } from "@/lib/usage-hash";
import { fakeR2 } from "../uploads/uploads-test-helpers";
import { claimGuest } from "./claim";
import { finishParkedClaim } from "./claim-finish";
import { seedAccount, seedGuest } from "./claim-test-helpers";

/** Spec 0023 step 6 (AC-8, G19): which account a guest take's minutes are charged to, and when. */

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_usage" });
});
afterAll(() => testDb?.close());

beforeEach(async () => {
  for (const row of [
    { key: "usage_limit_enabled", value: true },
    { key: "free_monthly_seconds", value: 3600 },
  ]) {
    await testDb.db
      .insert(appSetting)
      .values(row)
      .onConflictDoUpdate({ target: appSetting.key, set: { value: row.value } });
  }
});

const db = () => testDb.db;
const used = (hash: string) => getUsedSeconds(db(), { accountHash: hash, month: MONTH });
const email = () => `${crypto.randomUUID()}@example.com`;

async function guestWithTake(seconds: number) {
  const g = await seedGuest(db());
  const t = g.takes[0];
  if (!t) throw new Error("no take");
  await db()
    .update(take)
    .set({ durationMs: seconds * 1000 })
    .where(eq(take.id, t.id));
  return { ...g, takeId: t.id };
}
const start = (creatorId: string, takeId: string) =>
  startJob(db(), { creatorId, takeId, usageSecret: SECRET, now: NOW });
const claim = (g: { claimId: string; token: string }, userId: string) =>
  claimGuest(
    { db: db(), r2: fakeR2().r2, usageSecret: SECRET, now: () => NOW },
    { claimId: g.claimId, userId, cookie: g.token, confirmed: true },
  );
const jobOf = async (takeId: string) => {
  const [row] = await db().select().from(processingJob).where(eq(processingJob.takeId, takeId));
  if (!row) throw new Error("no job");
  return row;
};

describe("a guest take at job start (AC-8, G19)", () => {
  it("charges no account: the job keeps its seconds, no hash, nothing in usage_month", async () => {
    const before = (await db().select().from(usageMonth)).length;
    const g = await guestWithTake(125);
    const started = await start(g.guestId, g.takeId);
    expect(started.ok).toBe(true);
    const job = await jobOf(g.takeId);
    expect(job).toMatchObject({
      secondsCharged: 125,
      chargedAccountHash: null,
      usageCounted: false,
    });
    expect((await db().select().from(usageMonth)).length).toBe(before);
  });

  it("a refund after a guest failure only marks the job refunded, no usage moves", async () => {
    const before = (await db().select().from(usageMonth)).length;
    const g = await guestWithTake(90);
    const started = await start(g.guestId, g.takeId);
    if (!started.ok) throw new Error("start failed");
    const done = await finish(db(), {
      jobId: started.data.id,
      status: "failed",
      failureCode: "timeout",
    });
    expect(done.ok).toBe(true);
    expect((await jobOf(g.takeId)).refunded).toBe(true);
    expect((await db().select().from(usageMonth)).length).toBe(before);
  });
});

describe("a parked claim that moves its take (AC-8)", () => {
  it("charges the claimant for a job that started while the take was parked", async () => {
    const g = await guestWithTake(125);
    const me = await seedAccount(db(), email());
    const hash = await usageAccountHash(me.email, SECRET);
    const started = await start(g.guestId, g.takeId);
    expect(started.ok).toBe(true);
    await db().update(guestClaim).set({ claimUserId: me.id }).where(eq(guestClaim.id, g.claimId));
    const before = await used(hash);
    expect(await finishParkedClaim(db(), g.takeId, SECRET)).toBe(true);
    expect((await jobOf(g.takeId)).chargedAccountHash).toBe(hash);
    expect((await used(hash)) - before).toBe(125);
  });

  it("does nothing without the usage secret, so the take waits for the next call", async () => {
    const g = await guestWithTake(60);
    const me = await seedAccount(db(), email());
    await db().update(guestClaim).set({ claimUserId: me.id }).where(eq(guestClaim.id, g.claimId));
    expect(await finishParkedClaim(db(), g.takeId, undefined)).toBe(false);
    const [row] = await db().select().from(take).where(eq(take.id, g.takeId));
    expect(row?.creatorId).toBe(g.guestId);
  });
});

describe("a claim after job start (AC-8)", () => {
  it("adds the job's stored seconds, not the reserved minutes, and remembers the hash", async () => {
    const g = await guestWithTake(125);
    const me = await seedAccount(db(), email());
    const hash = await usageAccountHash(me.email, SECRET);
    const started = await start(g.guestId, g.takeId);
    if (!started.ok) throw new Error("start failed");
    expect(await claim(g, me.id)).toMatchObject({ ok: true, data: { kind: "done" } });
    expect(await used(hash)).toBe(125);
    expect(await jobOf(g.takeId)).toMatchObject({
      chargedAccountHash: hash,
      usageCounted: true,
      chargedMonth: MONTH,
    });
  });

  it("keeps the take whole even when the charge passes the allowance", async () => {
    const me = await seedAccount(db(), email());
    const hash = await usageAccountHash(me.email, SECRET);
    const first = await guestWithTake(3500);
    const second = await guestWithTake(180);
    for (const g of [first, second]) {
      const s = await start(g.guestId, g.takeId);
      if (!s.ok) throw new Error("start failed");
      expect(await claim(g, me.id)).toMatchObject({ ok: true, data: { kind: "done" } });
    }
    expect(await used(hash)).toBe(3680);
  });

  it("a later failure refunds the claimant's seconds once", async () => {
    const g = await guestWithTake(100);
    const me = await seedAccount(db(), email());
    const hash = await usageAccountHash(me.email, SECRET);
    const started = await start(g.guestId, g.takeId);
    if (!started.ok) throw new Error("start failed");
    await claim(g, me.id);
    expect(await used(hash)).toBe(100);
    await finish(db(), { jobId: started.data.id, status: "failed", failureCode: "timeout" });
    expect(await used(hash)).toBe(0);
  });

  it("charges nothing for a job that was already refunded", async () => {
    const g = await guestWithTake(100);
    const me = await seedAccount(db(), email());
    const hash = await usageAccountHash(me.email, SECRET);
    const started = await start(g.guestId, g.takeId);
    if (!started.ok) throw new Error("start failed");
    await finish(db(), { jobId: started.data.id, status: "failed", failureCode: "timeout" });
    await claim(g, me.id);
    expect(await used(hash)).toBe(0);
  });

  it("a claim before job start charges nothing; job start then charges the claimant once", async () => {
    const g = await guestWithTake(120);
    const me = await seedAccount(db(), email());
    const hash = await usageAccountHash(me.email, SECRET);
    await claim(g, me.id);
    expect(await used(hash)).toBe(0);
    expect((await start(me.id, g.takeId)).ok).toBe(true);
    expect(await used(hash)).toBe(120);
  });
});

describe("the guest_origin ceiling rule (AC-8)", () => {
  /** An account that already used `seconds` of its 3600 this month. */
  async function accountAt(seconds: number) {
    const me = await seedAccount(db(), email());
    const hash = await usageAccountHash(me.email, SECRET);
    await db()
      .insert(usageMonth)
      .values({ accountHash: hash, month: MONTH, secondsUsed: seconds, hashVersion: 1 });
    return { me, hash };
  }
  const claimedTake = async (seconds: number, userId: string) => {
    const g = await guestWithTake(seconds);
    await claim(g, userId);
    return g.takeId;
  };

  it("lets the one take that crosses 60 minutes through when the account is under it", async () => {
    const { me, hash } = await accountAt(3540);
    const takeId = await claimedTake(180, me.id);
    expect((await start(me.id, takeId)).ok).toBe(true);
    expect(await used(hash)).toBe(3720);
  });

  it("refuses the next guest take once the account is at or over 60 minutes", async () => {
    const { me, hash } = await accountAt(3540);
    const a = await claimedTake(180, me.id);
    const b = await claimedTake(60, me.id);
    expect((await start(me.id, a)).ok).toBe(true);
    expect(await start(me.id, b)).toEqual({ ok: false, error: "limit_exceeded" });
    expect(await used(hash)).toBe(3720);
  });

  it("does not apply to a take that did not come from a guest drop", async () => {
    const { me } = await accountAt(3540);
    const t = await seedTake(db(), me.id, { durationMs: 180_000, status: "uploaded" });
    expect(await start(me.id, t.id)).toEqual({ ok: false, error: "limit_exceeded" });
  });
});
