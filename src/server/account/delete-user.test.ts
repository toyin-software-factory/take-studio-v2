import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  account,
  rateLimit,
  session,
  signInEmailAttempt,
  storageDeletion,
  take,
  user,
  verification,
} from "@/db/schema";
import { type TestDb, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import type { OutgoingEmail } from "@/lib/email/send";
import { createAuth } from "../auth";
import { ACCOUNT_DELETE_FRESH_SECONDS } from "./policy";

/**
 * Self serve Delete account (spec 0015 step 7, AC-13) through the real Better Auth handler:
 * the magic link round trip, the fresh session guard, and that nothing is left. Synthetic
 * accounts only (`*.example.test`).
 */

const ENV = {
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
};
const ORIGIN = "http://localhost:3000";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_delete_account" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
beforeEach(async () => {
  for (const table of [session, account, verification, rateLimit, signInEmailAttempt])
    await db.delete(table);
  await db.delete(user);
});

function setup() {
  const sent: OutgoingEmail[] = [];
  const auth = createAuth(db, ENV, {
    sendEmail: async (email) => {
      sent.push(email);
      return { ok: true, data: { id: "em_1" } };
    },
  });
  return { auth, sent };
}
type TestAuth = ReturnType<typeof setup>["auth"];

/** The whole link round trip: ask for a link, follow it, return the session cookie. */
async function signInByLink(auth: TestAuth, sent: OutgoingEmail[], email: string) {
  const ask = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": "203.0.113.9",
      },
      body: JSON.stringify({ email, callbackURL: "/library?delete-account=1" }),
    }),
  );
  expect(ask.status).toBe(200);
  const mail = sent.at(-1);
  const token = new URL(/https?:\/\/[^\s"<]+/.exec(mail?.text ?? "")?.[0] ?? "").searchParams.get(
    "token",
  );
  const verify = await auth.handler(
    new Request(
      `${ORIGIN}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent("/library?delete-account=1")}&errorCallbackURL=/sign-in/link-expired`,
    ),
  );
  expect(verify.status).toBe(302);
  // The link brings the creator back to the delete dialog.
  expect(verify.headers.get("location")).toContain("/library?delete-account=1");
  const cookie = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(
    verify.headers.get("set-cookie") ?? "",
  )?.[0];
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

function deleteWith(auth: TestAuth, cookie: string) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/delete-user`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: "{}",
    }),
  );
}

async function userIdOf(email: string) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!row) throw new Error("no user");
  return row.id;
}

describe("self serve Delete account (spec 0015 AC-13)", () => {
  it("the guard is 10 minutes", () => {
    expect(ACCOUNT_DELETE_FRESH_SECONDS).toBe(600);
  });

  it("a fresh sign in deletes the account, every take and file, and clears the session", async () => {
    const { auth, sent } = setup();
    const email = "fresh@example.test";
    const cookie = await signInByLink(auth, sent, email);
    const id = await userIdOf(email);
    const one = await seedTake(db, id);
    const two = await seedTake(db, id);
    const bystander = await signInByLink(auth, sent, "bystander@example.test");
    const otherId = await userIdOf("bystander@example.test");
    const kept = await seedTake(db, otherId);

    const res = await deleteWith(auth, cookie);
    expect(res.status).toBe(200);
    // The session cookie is cleared, so the creator lands signed out.
    expect(res.headers.get("set-cookie") ?? "").toMatch(/session_token=;|Max-Age=0/);

    expect(await db.select().from(user).where(eq(user.id, id))).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, id))).toEqual([]);
    expect(await db.select().from(take).where(eq(take.creatorId, id))).toEqual([]);
    const queued = (await db.select().from(storageDeletion)).map((row) => row.objectKey);
    expect(queued).toEqual(expect.arrayContaining([one.originalKey, two.originalKey]));
    // Someone else's account and take are untouched.
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, kept.id))).toHaveLength(1);
    expect((await deleteWith(auth, bystander)).status).toBe(200);
  });

  it("a stale session is refused with SESSION_EXPIRED and nothing is deleted, then a fresh link works", async () => {
    const { auth, sent } = setup();
    const email = "stale@example.test";
    const cookie = await signInByLink(auth, sent, email);
    const id = await userIdOf(email);
    await seedTake(db, id);
    await db
      .update(session)
      .set({ createdAt: new Date(Date.now() - (ACCOUNT_DELETE_FRESH_SECONDS + 60) * 1000) })
      .where(eq(session.userId, id));

    const refused = await deleteWith(auth, cookie);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code?: string }).code).toBe("SESSION_EXPIRED");
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(1);
    expect(await db.select().from(take).where(eq(take.creatorId, id))).toHaveLength(1);

    // The magic link round trip: sign in again, and the same delete now goes through.
    const again = await signInByLink(auth, sent, email);
    expect((await deleteWith(auth, again)).status).toBe(200);
    expect(await db.select().from(user).where(eq(user.id, id))).toEqual([]);
    expect(await db.select().from(take).where(eq(take.creatorId, id))).toEqual([]);
  });
});
