import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedAccount, seedGuest } from "./claim-test-helpers";
import { storageDeletion, guestBudgetDay, guestClaim, guestIpDay, take, user } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import {
  deleteExpiredGuestTakes,
  deleteExpiredGuests,
  purgeOldGuestCounts,
} from "@/db/data/guest-expiry";

/** Spec 0023 step 7 (AC-9, G18, G28): the sweep that deletes expired guest drops. */

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_expiry" });
});
afterAll(() => testDb?.close());

const db = () => testDb.db;
const HOUR = 3_600_000;
const NOW = new Date("2026-11-16T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

async function dropAt(hours: number, typedEmail: string | null = null) {
  const g = await seedGuest(db(), { typedEmail });
  const t = g.takes[0];
  if (!t) throw new Error("no take");
  await db()
    .update(take)
    .set({ createdAt: ago(hours) })
    .where(eq(take.id, t.id));
  await db()
    .update(guestClaim)
    .set({ expiresAt: new Date(ago(hours).getTime() + 24 * HOUR) })
    .where(eq(guestClaim.id, g.claimId));
  return { ...g, takeId: t.id };
}
const takeExists = async (id: string) =>
  (await db().select().from(take).where(eq(take.id, id))).length === 1;
const userExists = async (id: string) =>
  (await db().select().from(user).where(eq(user.id, id))).length === 1;

describe("deleting expired guest takes (AC-9)", () => {
  it("deletes a take 24 hours after the drop, queues its file, reports the email flag", async () => {
    const g = await dropAt(25, "someone@example.com");
    const done = await deleteExpiredGuestTakes(db(), NOW);
    const mine = done.find((d) => d.takeId === g.takeId);
    expect(mine).toMatchObject({ hadEmail: true, runIds: [] });
    expect(await takeExists(g.takeId)).toBe(false);
    const queued = await db().select().from(storageDeletion);
    expect(queued.some((row) => row.objectKey === mine?.originalKey)).toBe(true);
  });

  it("keeps a take younger than 24 hours", async () => {
    const g = await dropAt(23);
    await deleteExpiredGuestTakes(db(), NOW);
    expect(await takeExists(g.takeId)).toBe(true);
  });

  it("never touches a take that was claimed (it follows normal retention)", async () => {
    const g = await dropAt(48);
    const me = await seedAccount(db(), `${crypto.randomUUID()}@example.com`);
    await db().update(take).set({ creatorId: me.id }).where(eq(take.id, g.takeId));
    await deleteExpiredGuestTakes(db(), NOW);
    expect(await takeExists(g.takeId)).toBe(true);
  });

  it("leaves the takes of a parked claim for the account that is waiting", async () => {
    const g = await dropAt(48);
    const me = await seedAccount(db(), `${crypto.randomUUID()}@example.com`);
    await db().update(guestClaim).set({ claimUserId: me.id }).where(eq(guestClaim.id, g.claimId));
    await deleteExpiredGuestTakes(db(), NOW);
    expect(await takeExists(g.takeId)).toBe(true);
  });

  it("reports the upload id of a take still uploading, so the caller can abort it", async () => {
    const g = await dropAt(30);
    await db()
      .update(take)
      .set({ status: "uploading", uploadId: "up-1" })
      .where(eq(take.id, g.takeId));
    const done = await deleteExpiredGuestTakes(db(), NOW);
    expect(done.find((d) => d.takeId === g.takeId)).toMatchObject({
      uploadId: "up-1",
      hadEmail: false,
    });
  });
});

describe("deleting expired guests and old counts (G18, G28)", () => {
  it("deletes the guest user and claim once expired with no take left", async () => {
    const g = await dropAt(30);
    await deleteExpiredGuestTakes(db(), NOW);
    expect(await deleteExpiredGuests(db(), NOW)).toBeGreaterThanOrEqual(1);
    expect(await userExists(g.guestId)).toBe(false);
    expect(await db().select().from(guestClaim).where(eq(guestClaim.id, g.claimId))).toHaveLength(
      0,
    );
  });

  it("keeps a guest that still has a take, and one whose claim has not expired", async () => {
    const withTake = await dropAt(30);
    const live = await dropAt(2);
    await db().delete(take).where(eq(take.id, live.takeId));
    await deleteExpiredGuests(db(), NOW);
    expect(await userExists(withTake.guestId)).toBe(true);
    expect(await userExists(live.guestId)).toBe(true);
  });

  it("a second drop moves expiry forward, so the older take goes but the guest stays", async () => {
    const g = await dropAt(30);
    await db()
      .update(guestClaim)
      .set({ expiresAt: new Date(NOW.getTime() + 10 * HOUR) })
      .where(eq(guestClaim.id, g.claimId));
    await deleteExpiredGuestTakes(db(), NOW);
    await deleteExpiredGuests(db(), NOW);
    expect(await takeExists(g.takeId)).toBe(false);
    expect(await userExists(g.guestId)).toBe(true);
  });

  it("purges count rows older than 2 days and keeps the rest", async () => {
    await db().delete(guestIpDay);
    await db().delete(guestBudgetDay);
    await db()
      .insert(guestIpDay)
      .values([
        { ipHash: "old", day: "2026-11-13", drops: 1 },
        { ipHash: "new", day: "2026-11-14", drops: 1 },
      ]);
    await db()
      .insert(guestBudgetDay)
      .values([
        { day: "2026-11-13", reservedMinutes: 5 },
        { day: "2026-11-14", reservedMinutes: 5 },
      ]);
    expect(await purgeOldGuestCounts(db(), NOW)).toBe(2);
    const ips = await db().select().from(guestIpDay);
    expect(ips.map((r) => r.ipHash)).toEqual(["new"]);
    expect((await db().select().from(guestBudgetDay)).map((r) => r.day)).toEqual(["2026-11-14"]);
  });
});
