import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey, revokeApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { type ApiAuthDeps, resolveCreator } from "./api-auth";
import { handleList as handleTakes, type TakeHttpDeps } from "./takes/http";
import { handleUsage } from "./usage/http";
import {
  ORIGIN,
  URL_BASE,
  bearer,
  noSession,
  type Session,
  uploadBad,
  usage,
} from "./api-auth-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_auth" });
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
const takeDeps = (deps: ApiAuthDeps): TakeHttpDeps => ({
  ...deps,
  allowedOrigin: ORIGIN,
  usageSecret: () => "x".repeat(40),
  triggerProcessTake: async () => ({ id: "run" }),
});
const takes = (deps: ApiAuthDeps, headers: Record<string, string> = {}) =>
  handleTakes(new Request(`${URL_BASE}/api/takes`, { headers }), takeDeps(deps));
describe("by key and by session (AC-5)", () => {
  it("gives the same answer for GET /api/usage", async () => {
    const c = await createCreator(db);
    const { key } = await makeKey(c.id);
    const bySession = await usage(authDeps({ sessionOf: c.id, calls: 0 }));
    const session = noSession();
    const byKey = await usage(authDeps(session), bearer(key));
    expect(byKey.status).toBe(200);
    expect(await byKey.json()).toEqual(await bySession.json());
    expect(session.calls).toBe(0);
  });

  it("GET /api/takes by key returns the key owner's takes only", async () => {
    const mine = await createCreator(db);
    const theirs = await createCreator(db);
    const t1 = await seedTake(db, mine.id, { status: "ready" });
    const t2 = await seedTake(db, theirs.id, { status: "ready" });
    const { key } = await makeKey(mine.id);
    const res = await takes(authDeps(noSession()), bearer(key));
    expect(res.status).toBe(200);
    const ids = (await res.json()).takes.map((t: { id: string }) => t.id);
    expect(ids).toContain(t1.id);
    expect(ids).not.toContain(t2.id);
    const bySession = await takes(authDeps({ sessionOf: mine.id, calls: 0 }));
    expect((await bySession.json()).takes.map((t: { id: string }) => t.id)).toEqual(ids);
  });

  it("no header and no session is 401 unauthorized as before", async () => {
    const res = await usage(authDeps(noSession()));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("resolveCreator is the one entry: a Result with the same Creator either way (AC-16)", async () => {
    const c = await createCreator(db);
    const { key } = await makeKey(c.id);
    const viaKey = await resolveCreator(
      new Request(URL_BASE, { headers: bearer(key) }),
      authDeps(noSession()),
    );
    const viaSession = await resolveCreator(
      new Request(URL_BASE),
      authDeps({ sessionOf: c.id, calls: 0 }),
    );
    expect(viaKey.ok && viaKey.data.creatorId).toBe(c.id);
    expect(viaSession.ok && viaSession.data.creatorId).toBe(c.id);
    const bad = await resolveCreator(
      new Request(URL_BASE, { headers: { authorization: "Bearer nope" } }),
      authDeps(noSession()),
    );
    expect(bad).toEqual({ ok: false, error: { kind: "invalid_api_key" } });
  });
});
describe("no fallback to the session (AC-5, AC-6)", () => {
  it("refuses any bad header with 401 invalid_api_key and never reads the cookie", async () => {
    const c = await createCreator(db);
    const { key } = await makeKey(c.id);
    for (const authorization of [
      "",
      "Bearer",
      "Bearer tsk_short",
      `Bearer ${generateApiKey()}`,
      `Basic ${key}`,
      key,
    ]) {
      const session: Session = { sessionOf: c.id, calls: 0 };
      const res = await usage(authDeps(session), { authorization });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("invalid_api_key");
      expect(session.calls).toBe(0);
    }
  });

  it("a deps object without key support still refuses a header", async () => {
    const c = await createCreator(db);
    const session: Session = { sessionOf: c.id, calls: 0 };
    const deps = { ...authDeps(session), keyAuth: undefined };
    expect((await usage(deps, { authorization: "Bearer x" })).status).toBe(401);
    expect(session.calls).toBe(0);
  });
});
describe("header only (AC-2)", () => {
  it("never reads a key from the query string: it is treated as no credential", async () => {
    const owner = await createCreator(db);
    const { key } = await makeKey(owner.id);
    const session = noSession();
    const res = await handleUsage(new Request(`${URL_BASE}/api/usage?key=${key}&api_key=${key}`), {
      ...authDeps(session),
      usageSecret: () => "x".repeat(40),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthorized");
  });
});
describe("a revoked key (AC-3, AC-5)", () => {
  it("is refused on the very next request", async () => {
    const c = await createCreator(db);
    const { key, id } = await makeKey(c.id);
    const deps = authDeps(noSession());
    expect((await usage(deps, bearer(key))).status).toBe(200);
    expect((await revokeApiKey(db, c.id, id)).ok).toBe(true);
    const after = await usage(deps, bearer(key));
    expect(after.status).toBe(401);
    expect((await after.json()).error).toBe("invalid_api_key");
  });
});
describe("Origin (AC-6)", () => {
  it("a session write from another origin is 403, and so is one with no Origin", async () => {
    const c = await createCreator(db);
    const deps = authDeps({ sessionOf: c.id, calls: 0 });
    expect((await uploadBad(deps, { origin: "https://evil.example" })).status).toBe(403);
    expect((await uploadBad(deps, {})).status).toBe(403);
    expect((await uploadBad(deps, { origin: ORIGIN })).status).toBe(422);
  });

  it("a bearer write skips the Origin check, with or without an Origin header", async () => {
    const c = await createCreator(db);
    const { key } = await makeKey(c.id);
    const deps = authDeps(noSession());
    expect((await uploadBad(deps, bearer(key))).status).toBe(422);
    expect((await uploadBad(deps, { ...bearer(key), origin: "https://evil.example" })).status).toBe(
      422,
    );
  });

  it("a bad bearer beside a valid cookie and a wrong Origin is 401, not 403 and not the session", async () => {
    const c = await createCreator(db);
    const session: Session = { sessionOf: c.id, calls: 0 };
    const res = await uploadBad(authDeps(session), {
      authorization: "Bearer nope",
      origin: "https://evil.example",
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_api_key");
    expect(session.calls).toBe(0);
  });
});
