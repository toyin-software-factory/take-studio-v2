import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import { GUEST_COOKIE } from "@/lib/guest-rules";
import { ORIGIN, fakeR2 } from "../uploads/uploads-test-helpers";
import { handleGuestClaim } from "./claim-http";
import { seedAccount, seedGuest, takesOf } from "./claim-test-helpers";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_claim_http" });
});
afterAll(() => testDb?.close());

const post = (payload: unknown, origin: string | null = ORIGIN, cookie?: string) =>
  new Request(`${ORIGIN}/api/guest/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie: `${GUEST_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify(payload),
  });

const depsFor = (userId: string | null) => ({
  appOrigin: ORIGIN,
  secureCookie: true,
  signedInUserId: async () => userId,
  claimDeps: async () => ({ db: testDb.db, r2: fakeR2().r2 }),
});

describe("POST /api/guest/claim, the confirm click (spec 0023, C5)", () => {
  it("claims after the click for an email only match, and points at the take", async () => {
    const typed = `${crypto.randomUUID()}@example.com`;
    const g = await seedGuest(testDb.db, { typedEmail: typed });
    const me = await seedAccount(testDb.db, typed);
    const res = await handleGuestClaim(post({ claimId: g.claimId }), depsFor(me.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, target: `/takes/${g.takes[0]?.id}` });
    expect(await takesOf(testDb.db, me.id)).toHaveLength(1);
  });

  it("refuses a signed out caller, a foreign origin and a stranger", async () => {
    const g = await seedGuest(testDb.db, { typedEmail: "other@example.com" });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    expect((await handleGuestClaim(post({ claimId: g.claimId }), depsFor(null))).status).toBe(401);
    expect(
      (await handleGuestClaim(post({ claimId: g.claimId }, "https://evil.example"), depsFor(me.id)))
        .status,
    ).toBe(403);
    expect((await handleGuestClaim(post({ claimId: g.claimId }), depsFor(me.id))).status).toBe(404);
    expect((await handleGuestClaim(post({ claimId: "x" }), depsFor(me.id))).status).toBe(422);
    expect(await takesOf(testDb.db, me.id)).toHaveLength(0);
  });
});
