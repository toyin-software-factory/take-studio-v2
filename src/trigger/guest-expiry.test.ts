import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyticsEvent, guestClaim, take, user } from "@/db/schema";
import { type TestDb, openTestDb, seedTake } from "@/db/testing/test-db";
import { hashGuestToken } from "@/lib/guest-hash";
import { guestEmail } from "@/lib/guest-rules";
import { sweepExpiredGuests } from "./guest-expiry";

/** Spec 0023 AC-12: the sweep records one guest_expired per deleted take, a flag and nothing else. */

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_expiry_events" });
});
afterAll(() => testDb?.close());

const HOUR = 3_600_000;
const NOW = new Date("2026-11-16T12:00:00Z");
const r2 = { abortMultipartUpload: async () => undefined } as never;

async function expiredDrop(typedEmail: string | null) {
  const { db } = testDb;
  const id = `guest-${crypto.randomUUID()}`;
  await db.insert(user).values({
    id,
    name: "Guest",
    email: guestEmail(id),
    emailVerified: false,
    takeEmails: false,
    guest: true,
  });
  await db.insert(guestClaim).values({
    guestUserId: id,
    tokenHash: await hashGuestToken(`tok-${crypto.randomUUID()}`),
    email: typedEmail,
    ipHash: "iphash",
    expiresAt: new Date(NOW.getTime() - HOUR),
  });
  const t = await seedTake(db, id, { status: "uploaded", guestOrigin: true });
  await db
    .update(take)
    .set({ createdAt: new Date(NOW.getTime() - 25 * HOUR) })
    .where(eq(take.id, t.id));
}

describe("the sweep records guest_expired (AC-12)", () => {
  it("writes one event per deleted take, with hadEmail and no creator or take", async () => {
    const { db } = testDb;
    await db.delete(analyticsEvent);
    await expiredDrop("someone@example.com");
    await expiredDrop(null);
    await sweepExpiredGuests(db, r2, NOW);
    const rows = await db
      .select()
      .from(analyticsEvent)
      .where(eq(analyticsEvent.name, "guest_expired"));
    expect(rows).toHaveLength(2);
    const flags = rows.map((r) => (r.props as { hadEmail: boolean }).hadEmail).sort();
    expect(flags).toEqual([false, true]);
    expect(rows.every((r) => r.creatorId === null && r.takeId === null)).toBe(true);
  });
});
