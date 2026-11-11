import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { account, rateLimit, session, signInEmailAttempt, user, verification } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type AuthDeps, createAuth } from "./auth";
import type { OutgoingEmail } from "./email/send";

// Test values only.
const ENV = {
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
};

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_auth" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
beforeEach(async () => {
  await db.delete(session);
  await db.delete(account);
  await db.delete(verification);
  await db.delete(user);
  await db.delete(rateLimit);
  await db.delete(signInEmailAttempt);
});

function setup(options: { sendFails?: boolean } = {}) {
  const sent: OutgoingEmail[] = [];
  const deps: AuthDeps = {
    sendEmail: async (email) => {
      sent.push(email);
      return options.sendFails
        ? { ok: false, error: "unavailable" }
        : { ok: true, data: { id: "em_1" } };
    },
  };
  return { auth: createAuth(db, ENV, deps), sent };
}

const tokenOf = (mail: OutgoingEmail | undefined) =>
  new URL(/https?:\/\/[^\s"<]+/.exec(mail?.text ?? "")?.[0] ?? "").searchParams.get("token") ?? "";

async function request(auth: ReturnType<typeof createAuth>, email: string, ip = "203.0.113.5") {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email, callbackURL: "/" }),
    }),
  );
}

describe("email sign in link (spec 0006)", () => {
  it("sends one link that signs in once (AC-1, AC-2)", async () => {
    const { auth, sent } = setup();
    const res = await request(auth, "Creator@Example.com");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("Creator@Example.com");
    const token = tokenOf(sent[0]);
    expect(token.length).toBeGreaterThan(10);

    const verify = (t: string) =>
      auth.handler(
        new Request(
          `http://localhost:3000/api/auth/magic-link/verify?token=${t}&callbackURL=/&errorCallbackURL=/sign-in/link-expired`,
        ),
      );
    const first = await verify(token);
    expect(first.status).toBe(302);
    expect(first.headers.get("set-cookie")).toContain("session_token");
    expect((await db.select().from(user)).map((u) => u.email)).toEqual(["creator@example.com"]);

    // A used link goes to the friendly page, with no new session.
    const second = await verify(token);
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toContain("/sign-in/link-expired");
    expect(second.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(await db.select().from(session)).toHaveLength(1);
  });

  it("an expired link goes to the friendly page (AC-2)", async () => {
    const { auth, sent } = setup();
    await request(auth, "late@example.com");
    const token = tokenOf(sent[0]);
    await db.update(verification).set({ expiresAt: new Date(Date.now() - 60_000) });
    const res = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=/&errorCallbackURL=/sign-in/link-expired`,
      ),
    );
    expect(res.headers.get("location")).toContain("/sign-in/link-expired");
    expect(await db.select().from(session)).toHaveLength(0);
  });

  it("the link lifetime is 15 minutes (AC-2)", async () => {
    const { auth } = setup();
    const before = Date.now();
    await request(auth, "ttl@example.com");
    const [row] = await db.select().from(verification);
    const ttl = (row?.expiresAt.getTime() ?? 0) - before;
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 5_000);
  });

  it("answers the same for a known and an unknown email (AC-1)", async () => {
    const { auth } = setup();
    await db.insert(user).values({ id: "u-known", name: "Known", email: "known@example.com" });
    const known = await request(auth, "known@example.com");
    const unknown = await request(auth, "nobody@example.com");
    expect(known.status).toBe(unknown.status);
    expect(await known.clone().text()).toBe(await unknown.clone().text());
  });

  it("the same email by Google and by link is one account (AC-3)", async () => {
    const { auth, sent } = setup();
    const now = new Date();
    await db
      .insert(user)
      .values({ id: "u-google", name: "G", email: "same@example.com", emailVerified: true });
    await db.insert(account).values({
      id: "a1",
      accountId: "google-sub",
      providerId: "google",
      userId: "u-google",
      createdAt: now,
      updatedAt: now,
    });
    await request(auth, "same@example.com");
    await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/magic-link/verify?token=${tokenOf(sent[0])}&callbackURL=/`,
      ),
    );
    const users = await db.select().from(user).where(eq(user.email, "same@example.com"));
    expect(users).toHaveLength(1);
    const [s] = await db.select().from(session);
    expect(s?.userId).toBe("u-google");
  });

  it("limits to 3 requests per email per 15 minutes, other emails unaffected (AC-4)", async () => {
    const { auth, sent } = setup();
    for (let n = 0; n < 3; n += 1) {
      expect((await request(auth, "busy@example.com", `198.51.100.${n}`)).status).toBe(200);
    }
    const fourth = await request(auth, "BUSY@example.com ", "198.51.100.9");
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { code?: string }).code).toBe("EMAIL_RATE_LIMITED");
    expect(sent).toHaveLength(3);
    expect((await request(auth, "other@example.com", "198.51.100.10")).status).toBe(200);
  });

  it("limits to 10 requests per IP per hour, stored in the database (AC-4)", async () => {
    const { auth } = setup();
    for (let n = 0; n < 10; n += 1) {
      expect((await request(auth, `p${n}@example.com`, "192.0.2.77")).status).toBe(200);
    }
    expect((await request(auth, "p10@example.com", "192.0.2.77")).status).toBe(429);
    expect((await request(auth, "p10@example.com", "192.0.2.78")).status).toBe(200);
    expect((await db.select().from(rateLimit)).length).toBeGreaterThan(0);
  });

  it("a failed send is a 503 the form can explain (AC-8)", async () => {
    const { auth } = setup({ sendFails: true });
    const res = await request(auth, "fail@example.com");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe("EMAIL_SEND_FAILED");
  });

  it("without a sender configured it is also the friendly 503 (AC-8)", async () => {
    const res = await request(createAuth(db, ENV), "nosender@example.com");
    expect(res.status).toBe(503);
  });
});
