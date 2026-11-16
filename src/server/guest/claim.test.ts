import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyticsEvent, processingJob } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import { SECRET } from "@/db/data/usage-test-helpers";
import { fakeR2 } from "../uploads/uploads-test-helpers";
import { claimGuest } from "./claim";
import { guestExists, seedAccount, seedGuest, takesOf } from "./claim-test-helpers";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_claim" });
});
afterAll(() => testDb?.close());

const run = (
  input: Omit<Parameters<typeof claimGuest>[1], "confirmed"> & { confirmed?: boolean },
  r2 = fakeR2().r2,
) => claimGuest({ db: testDb.db, r2, usageSecret: SECRET }, { confirmed: false, ...input });

describe("the claim (spec 0023, AC-3, AC-5)", () => {
  it("moves one take at once on a cookie match, whatever the email, and deletes the guest", async () => {
    const g = await seedGuest(testDb.db);
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    const res = await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    expect(res).toMatchObject({ ok: true, data: { kind: "done", via: "cookie" } });
    const mine = await takesOf(testDb.db, me.id);
    expect(mine.map((t) => t.id)).toEqual([g.takes[0]?.id]);
    expect(mine[0]?.createdAt).toEqual(g.takes[0]?.createdAt);
    expect(await guestExists(testDb.db, g.guestId)).toBe(false);
  });

  it("moves several takes at once", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploaded", "ready", "uploaded"] });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    const res = await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    expect(res.ok && res.data.kind === "done" && res.data.moved.length).toBe(3);
    expect(await takesOf(testDb.db, me.id)).toHaveLength(3);
  });

  it("needs the confirm click when only the verified email matches, and moves nothing before it", async () => {
    const typed = `${crypto.randomUUID()}@example.com`;
    const g = await seedGuest(testDb.db, { typedEmail: typed });
    const me = await seedAccount(
      testDb.db,
      typed.toUpperCase().replace("@EXAMPLE.COM", "@example.com"),
    );
    const first = await run({ claimId: g.claimId, userId: me.id, cookie: null });
    expect(first).toEqual({ ok: true, data: { kind: "confirm" } });
    expect(await takesOf(testDb.db, me.id)).toHaveLength(0);
    expect(await guestExists(testDb.db, g.guestId)).toBe(true);
    const second = await run({ claimId: g.claimId, userId: me.id, cookie: null, confirmed: true });
    expect(second).toMatchObject({ ok: true, data: { kind: "done", via: "email" } });
    expect(await takesOf(testDb.db, me.id)).toHaveLength(1);
  });

  it("does not match an unverified email", async () => {
    const typed = `${crypto.randomUUID()}@example.com`;
    const g = await seedGuest(testDb.db, { typedEmail: typed });
    const me = await seedAccount(testDb.db, typed, false);
    const res = await run({ claimId: g.claimId, userId: me.id, cookie: null, confirmed: true });
    expect(res).toEqual({ ok: true, data: { kind: "none" } });
    expect(await takesOf(testDb.db, me.id)).toHaveLength(0);
  });

  it("gives a stranger the calm none answer (AC-5), also for unknown and malformed ids", async () => {
    const g = await seedGuest(testDb.db, { typedEmail: "someone@example.com" });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    const none = { ok: true, data: { kind: "none" } };
    expect(
      await run({ claimId: g.claimId, userId: me.id, cookie: "wrong", confirmed: true }),
    ).toEqual(none);
    expect(await run({ claimId: crypto.randomUUID(), userId: me.id, cookie: g.token })).toEqual(
      none,
    );
    expect(await run({ claimId: "not-a-uuid", userId: me.id, cookie: g.token })).toEqual(none);
    expect(await takesOf(testDb.db, me.id)).toHaveLength(0);
  });

  it("answers none for a second claim of the same id", async () => {
    const g = await seedGuest(testDb.db);
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    const again = await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    expect(again).toEqual({ ok: true, data: { kind: "none" } });
  });

  it("lets only one of two accounts win a race, and loses no take", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploaded", "uploaded"] });
    const a = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    const b = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    await Promise.all([
      run({ claimId: g.claimId, userId: a.id, cookie: g.token }),
      run({ claimId: g.claimId, userId: b.id, cookie: g.token }),
    ]);
    const [ta, tb] = [await takesOf(testDb.db, a.id), await takesOf(testDb.db, b.id)];
    expect([ta.length, tb.length].sort()).toEqual([0, 2]);
  });

  it("moves a finished take and parks one still uploading", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploaded", "uploading"] });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    const res = await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    expect(res).toMatchObject({ ok: true, data: { kind: "done" } });
    expect(res.ok && res.data.kind === "done" && res.data.pending).toEqual([g.takes[1]?.id]);
    expect(await takesOf(testDb.db, me.id)).toHaveLength(1);
    expect(await guestExists(testDb.db, g.guestId)).toBe(true);
  });

  it("records guest_claimed with timing parked when a take is still uploading (AC-12)", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploaded", "uploading"] });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    const rows = await testDb.db
      .select()
      .from(analyticsEvent)
      .where(eq(analyticsEvent.creatorId, me.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "guest_claimed",
      props: { via: "cookie", timing: "parked" },
    });
  });
  it("records guest_claimed once when the same account repeats a parked claim", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploaded", "uploading"] });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    const again = await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    expect(again).toMatchObject({ ok: true, data: { kind: "done" } });
    const rows = await testDb.db
      .select()
      .from(analyticsEvent)
      .where(eq(analyticsEvent.creatorId, me.id));
    expect(rows).toHaveLength(1);
  });

  it("records after_start for a job that started and was refunded before the claim (AC-12)", async () => {
    const g = await seedGuest(testDb.db);
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    await testDb.db.insert(processingJob).values({
      id: crypto.randomUUID(),
      takeId: g.takes[0]?.id ?? "",
      kind: "initial",
      status: "failed",
      secondsCharged: 100,
      refunded: true,
    });
    await run({ claimId: g.claimId, userId: me.id, cookie: g.token });
    const [row] = await testDb.db
      .select()
      .from(analyticsEvent)
      .where(eq(analyticsEvent.creatorId, me.id));
    expect(row).toMatchObject({ props: { via: "cookie", timing: "after_start" } });
  });
});
