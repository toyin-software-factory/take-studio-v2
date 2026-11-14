import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apiKey, apiRateWindow } from "@/db/schema";
import { createApiKey, revokeApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { type ApiAuthDeps, resolveCreator } from "./api-auth";
import { handleList as handleTakes, type TakeHttpDeps } from "./takes/http";
import type { UploadDeps } from "./uploads";
import { handleCreate as handleUploadCreate, type HttpDeps } from "./uploads/http";
import { handleUsage } from "./usage/http";

/**
 * Spec 0018 step 3: one identity entry point and one guard (AC-5, AC-6, AC-9, AC-10, AC-16),
 * through the real handlers GET /api/usage, GET /api/takes and POST /api/uploads.
 */
const ORIGIN = "https://take-studio.example";
const URL_BASE = "https://take-studio.example";
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_auth" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

type Session = { sessionOf: string | null; calls: number };
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
const noSession = (): Session => ({ sessionOf: null, calls: 0 });

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

const usage = (deps: ApiAuthDeps, headers: Record<string, string> = {}) =>
  handleUsage(new Request(`${URL_BASE}/api/usage`, { headers }), {
    ...deps,
    usageSecret: () => "x".repeat(40),
  });
const takeDeps = (deps: ApiAuthDeps): TakeHttpDeps => ({
  ...deps,
  allowedOrigin: ORIGIN,
  usageSecret: () => "x".repeat(40),
  triggerProcessTake: async () => ({ id: "run" }),
});
const takes = (deps: ApiAuthDeps, headers: Record<string, string> = {}) =>
  handleTakes(new Request(`${URL_BASE}/api/takes`, { headers }), takeDeps(deps));
const uploadDeps = (deps: ApiAuthDeps): HttpDeps => ({
  ...deps,
  allowedOrigin: ORIGIN,
  // Bad input is refused before any upload dependency is touched.
  uploadDeps: () => ({}) as UploadDeps,
});
const uploadBad = (deps: ApiAuthDeps, headers: Record<string, string>) =>
  handleUploadCreate(
    new Request(`${URL_BASE}/api/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    }),
    uploadDeps(deps),
  );
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

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
      `bearer ${key}`,
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

describe("rate limit (AC-9)", () => {
  const at = new Date("2026-11-14T10:05:42.000Z");

  it("allows 120 a minute per key and refuses the 121st with Retry-After", async () => {
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
  });

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

describe("private (AC-13)", () => {
  it("logs one api_key_rejected line with a reason only, never the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const c = await createCreator(db);
      const { key } = await makeKey(c.id);
      const wrong = `${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`;
      const res = await usage(authDeps(noSession()), bearer(wrong));
      expect(res.status).toBe(401);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("api_key_rejected", { reason: "unknown" });
      const all = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(all).not.toContain(wrong);
      expect(all).not.toContain(await hashApiKey(wrong));
      expect(all).not.toContain(wrong.slice(4, 12));
      expect(JSON.stringify(await res.json())).not.toContain(wrong);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe("one guard (AC-5)", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("builds no session check of its own in the usage, takes and uploads modules", () => {
    for (const dir of ["usage", "takes", "uploads", "api-keys"]) {
      expect(read(`src/server/${dir}/http.ts`)).not.toMatch(/deps\.getCreator\(/);
      expect(read(`src/server/${dir}/deps.ts`)).not.toMatch(/getSession\(/);
    }
  });
});
