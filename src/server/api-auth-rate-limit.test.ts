import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apiKey, apiRateWindow } from "@/db/schema";
import { createApiKey, revokeApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { type ApiAuthDeps } from "./api-auth";
import { ORIGIN, bearer, noSession, type Session, uploadBad, usage } from "./api-auth-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_auth_2" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
function authDeps(
  session: Session,
  now?: () => Date,
): Required<Pick<ApiAuthDeps, "allowedOrigin">> & ApiAuthDeps {
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => {
      session.calls++;
      return session.sessionOf ? { db, creatorId: session.sessionOf } : null;
    },
    keyAuth: { getDb: async () => db, now },
  };
}
async function makeKey(creatorId: string) {
  const key = generateApiKey();
  const made = await createApiKey(db, {
    creatorId,
    name: "agent",
    prefix: apiKeyPrefix(key),
    keyHash: await hashApiKey(key),
  });
  if (!made.ok) throw new Error("no key");
  return { key, id: made.data.id };
}
describe("rate limit (AC-9)", () => {
  const at = new Date("2026-11-14T10:05:42.000Z");

  it(
    "allows 120 a minute per key and refuses the 121st with Retry-After",
    { timeout: 30_000 },
    async () => {
      const c = await createCreator(db);
      const { key, id } = await makeKey(c.id);
      const other = await makeKey(c.id);
      const deps = authDeps(noSession(), () => at);
      for (let i = 0; i < 120; i++) {
        expect((await usage(deps, bearer(key))).status).toBe(200);
      }
      const over = await usage(deps, bearer(key));
      expect(over.status).toBe(429);
      expect(over.headers.get("retry-after")).toBe("18");
      expect((await over.json()).error).toBe("rate_limited");
      // The refused request counts too.
      await usage(deps, bearer(key));
      const [row] = await db.select().from(apiRateWindow).where(eq(apiRateWindow.keyId, id));
      expect(row?.count).toBe(122);
      // Another key is not slowed.
      expect((await usage(deps, bearer(other.key))).status).toBe(200);
      // The next minute starts again.
      const later = authDeps(noSession(), () => new Date(at.getTime() + 60_000));
      expect((await usage(later, bearer(key))).status).toBe(200);
    },
  );

  it("counts a key request, never a session request or an unknown key", async () => {
    const c = await createCreator(db);
    const { id } = await makeKey(c.id);
    const deps = authDeps({ sessionOf: c.id, calls: 0 }, () => at);
    for (let i = 0; i < 3; i++) await usage(deps);
    await usage(deps, bearer(generateApiKey()));
    expect(await db.select().from(apiRateWindow).where(eq(apiRateWindow.keyId, id))).toHaveLength(
      0,
    );
  });

  it("never lets concurrent requests over count past the atomic upsert", async () => {
    const c = await createCreator(db);
    const { key, id } = await makeKey(c.id);
    const deps = authDeps(noSession(), () => at);
    await Promise.all(Array.from({ length: 30 }, () => usage(deps, bearer(key))));
    const [row] = await db.select().from(apiRateWindow).where(eq(apiRateWindow.keyId, id));
    expect(row?.count).toBe(30);
  });

  it("uses the database clock when no test clock is given", async () => {
    const c = await createCreator(db);
    const { key, id } = await makeKey(c.id);
    expect((await usage(authDeps(noSession()), bearer(key))).status).toBe(200);
    const [row] = await db.select().from(apiRateWindow).where(eq(apiRateWindow.keyId, id));
    expect(row?.count).toBe(1);
    expect(row?.windowStart.getUTCSeconds()).toBe(0);
    expect(Math.abs(row!.windowStart.getTime() - Date.now())).toBeLessThan(120_000);
  });
});
describe("Origin edge cases (AC-6, B2-T90)", () => {
  it("accepts only the exact origin: a trailing slash, a null origin and a look alike host are 403", async () => {
    const c = await createCreator(db);
    const deps = authDeps({ sessionOf: c.id, calls: 0 });
    for (const origin of [
      `${ORIGIN}/`,
      "null",
      "",
      `${ORIGIN}.evil.example`,
      "http://take-studio.example",
      ORIGIN.toUpperCase(),
    ]) {
      expect((await uploadBad(deps, { origin })).status).toBe(403);
    }
  });

  it("a wrong Origin is refused before the session is read", async () => {
    const c = await createCreator(db);
    const session: Session = { sessionOf: c.id, calls: 0 };
    expect((await uploadBad(authDeps(session), { origin: "https://evil.example" })).status).toBe(
      403,
    );
    expect(session.calls).toBe(0);
  });
});
describe("revoke in depth (AC-3, B2-T90)", () => {
  it("leaves the creator's other keys working", async () => {
    const c = await createCreator(db);
    const first = await makeKey(c.id);
    const second = await makeKey(c.id);
    const deps = authDeps(noSession());
    expect((await revokeApiKey(db, c.id, first.id)).ok).toBe(true);
    expect((await usage(deps, bearer(first.key))).status).toBe(401);
    expect((await usage(deps, bearer(second.key))).status).toBe(200);
  });

  it("a revoke by another creator changes nothing", async () => {
    const owner = await createCreator(db);
    const stranger = await createCreator(db);
    const { key, id } = await makeKey(owner.id);
    const result = await revokeApiKey(db, stranger.id, id);
    expect(result.ok).toBe(false);
    expect((await usage(authDeps(noSession()), bearer(key))).status).toBe(200);
  });

  it("a revoked key is refused and never reads the cookie", async () => {
    const c = await createCreator(db);
    const { key, id } = await makeKey(c.id);
    await revokeApiKey(db, c.id, id);
    const session: Session = { sessionOf: c.id, calls: 0 };
    const at = new Date("2026-11-14T11:00:10.000Z");
    expect(
      (
        await usage(
          authDeps(session, () => at),
          bearer(key),
        )
      ).status,
    ).toBe(401);
    expect(session.calls).toBe(0);
  });
});
describe("rate window edges (AC-9, B2-T90)", () => {
  it(
    "a key at its limit in one minute is fine in the first second of the next",
    { timeout: 30_000 },
    async () => {
      const c = await createCreator(db);
      const { key } = await makeKey(c.id);
      const end = new Date("2026-11-14T12:00:59.999Z");
      const endDeps = authDeps(noSession(), () => end);
      for (let i = 0; i < 120; i++) await usage(endDeps, bearer(key));
      const over = await usage(endDeps, bearer(key));
      expect(over.status).toBe(429);
      expect(over.headers.get("retry-after")).toBe("1");
      const next = authDeps(noSession(), () => new Date("2026-11-14T12:01:00.000Z"));
      expect((await usage(next, bearer(key))).status).toBe(200);
    },
  );

  it(
    "a refused request carries the private no store header and never reads the cookie",
    { timeout: 30_000 },
    async () => {
      const c = await createCreator(db);
      const { key } = await makeKey(c.id);
      const session: Session = { sessionOf: c.id, calls: 0 };
      const deps = authDeps(session, () => new Date("2026-11-14T13:00:30.000Z"));
      for (let i = 0; i < 120; i++) await usage(deps, bearer(key));
      const over = await usage(deps, bearer(key));
      expect(over.status).toBe(429);
      expect(over.headers.get("cache-control")).toBe("private, no-store");
      expect(session.calls).toBe(0);
    },
  );
});
describe("last used (AC-10)", () => {
  const lastUsed = async (id: string) =>
    (await db.select().from(apiKey).where(eq(apiKey.id, id)))[0]?.lastUsedAt ?? null;

  it("is set on the first use, then at most once an hour, and a failed check changes nothing", async () => {
    const c = await createCreator(db);
    const { key, id } = await makeKey(c.id);
    const deps = authDeps(noSession());
    expect(await lastUsed(id)).toBeNull();
    await usage(deps, bearer(key));
    const first = await lastUsed(id);
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await usage(deps, bearer(key));
    expect(await lastUsed(id)).toEqual(first);
    await usage(deps, bearer(`${key.slice(0, -1)}A`));
    expect(await lastUsed(id)).toEqual(first);
    const old = new Date(Date.now() - 2 * 3600_000);
    await db.update(apiKey).set({ lastUsedAt: old }).where(eq(apiKey.id, id));
    await usage(deps, bearer(key));
    expect((await lastUsed(id))!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
