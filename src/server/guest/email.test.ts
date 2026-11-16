import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guestClaim } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import { GUEST_COOKIE, claimPath, claimReturnPath } from "@/lib/guest-rules";
import { signInEmail } from "@/lib/email/templates";
import { ORIGIN } from "../uploads/uploads-test-helpers";
import { seedGuest } from "./claim-test-helpers";
import { type GuestEmailDeps, handleGuestEmail } from "./email";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_email" });
});
afterAll(() => testDb?.close());

function setup(fail?: "rate_limited" | "send_failed") {
  const sent: { email: string; callbackURL: string }[] = [];
  const deps: GuestEmailDeps = {
    appOrigin: ORIGIN,
    getDb: async () => testDb.db,
    hashSecret: () => "x".repeat(40),
    sendLink: async ({ email, callbackURL }) => {
      if (fail) return { ok: false, error: fail };
      sent.push({ email, callbackURL });
      return { ok: true, data: true };
    },
  };
  return { deps, sent };
}

const post = (payload: unknown, token: string | null) =>
  new Request(`${ORIGIN}/api/guest/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(token ? { cookie: `${GUEST_COOKIE}=${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

const rowOf = async (id: string) =>
  (await testDb.db.select().from(guestClaim).where(eq(guestClaim.id, id)))[0];

describe("POST /api/guest/email (spec 0023, AC-2, C2)", () => {
  it("sends one link with the claim page as the callback and stores the address lowercased", async () => {
    const g = await seedGuest(testDb.db);
    const { deps, sent } = setup();
    const res = await handleGuestEmail(post({ email: "  Maker@Example.com " }, g.token), deps);
    expect(res.status).toBe(200);
    expect(sent).toEqual([{ email: "maker@example.com", callbackURL: claimPath(g.claimId) }]);
    const row = await rowOf(g.claimId);
    expect(row).toMatchObject({ email: "maker@example.com", emailSends: 1 });
    expect(row?.emailHash).toMatch(/\S/);
  });

  it("replaces the first address with a second one", async () => {
    const g = await seedGuest(testDb.db);
    const { deps } = setup();
    await handleGuestEmail(post({ email: "a@example.com" }, g.token), deps);
    await handleGuestEmail(post({ email: "b@example.com" }, g.token), deps);
    expect((await rowOf(g.claimId))?.email).toBe("b@example.com");
  });

  it("allows 5 links and refuses the 6th with no send", async () => {
    const g = await seedGuest(testDb.db);
    const { deps, sent } = setup();
    for (let i = 0; i < 5; i++) {
      expect((await handleGuestEmail(post({ email: "a@example.com" }, g.token), deps)).status).toBe(
        200,
      );
    }
    const sixth = await handleGuestEmail(post({ email: "a@example.com" }, g.token), deps);
    expect(sixth.status).toBe(429);
    expect(sent).toHaveLength(5);
  });

  it("gives the send back when the link fails, and restores the earlier address", async () => {
    const g = await seedGuest(testDb.db, { typedEmail: "first@example.com" });
    const res = await handleGuestEmail(
      post({ email: "b@example.com" }, g.token),
      setup("send_failed").deps,
    );
    expect(res.status).toBe(503);
    expect(await rowOf(g.claimId)).toMatchObject({ email: "first@example.com", emailSends: 0 });
    const limited = await handleGuestEmail(
      post({ email: "b@example.com" }, g.token),
      setup("rate_limited").deps,
    );
    expect(limited.status).toBe(429);
  });

  it("refuses guest addresses, bad addresses, a missing cookie and a foreign origin", async () => {
    const g = await seedGuest(testDb.db);
    const { deps, sent } = setup();
    expect((await handleGuestEmail(post({ email: "x@guest.invalid" }, g.token), deps)).status).toBe(
      422,
    );
    expect((await handleGuestEmail(post({ email: "nope" }, g.token), deps)).status).toBe(422);
    expect((await handleGuestEmail(post({ email: "a@example.com" }, null), deps)).status).toBe(401);
    const foreign = new Request(`${ORIGIN}/api/guest/email`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "{}",
    });
    expect((await handleGuestEmail(foreign, deps)).status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe("the claim return path and the sign in email", () => {
  it("claimReturnPath accepts only /claim?c=<uuid>", () => {
    const id = crypto.randomUUID();
    const q = (v: string) => new URLSearchParams({ return: v });
    expect(claimReturnPath(q(`/claim?c=${id}`))).toBe(`/claim?c=${id}`);
    expect(claimReturnPath(q("/claim?c=abc"))).toBeNull();
    expect(claimReturnPath(q("https://evil.example/claim?c=" + id))).toBeNull();
    expect(claimReturnPath(q(`//evil.example/claim?c=${id}`))).toBeNull();
    expect(claimReturnPath(new URLSearchParams())).toBeNull();
  });

  it("adds the guest line only for a guest link", () => {
    const url = "https://take-studio.example/x";
    expect(signInEmail({ url, guest: true }).text).toContain("You dropped a video");
    expect(signInEmail({ url }).text).not.toContain("You dropped a video");
  });
});
