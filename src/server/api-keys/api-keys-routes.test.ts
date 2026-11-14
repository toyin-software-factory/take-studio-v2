import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apiKey } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { hashApiKey } from "@/lib/api-rules";
import { type ApiKeyHttpDeps, handleCreate, handleList, handleRevoke } from "./http";

/** Spec 0018 step 2 (AC-1, AC-3, AC-4, AC-13) through the real handlers and a real database. */
const ORIGIN = "https://take-studio.example";
let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_key_routes" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

const deps = (creatorId: string | null): ApiKeyHttpDeps => ({
  allowedOrigin: ORIGIN,
  getCreator: async () => (creatorId ? { db, creatorId } : null),
});

const post = (creatorId: string | null, body: unknown, headers: Record<string, string> = {}) =>
  handleCreate(
    new Request("https://take-studio.example/api/keys", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps(creatorId),
  );
const list = (creatorId: string | null, headers: Record<string, string> = {}) =>
  handleList(new Request("https://take-studio.example/api/keys", { headers }), deps(creatorId));
const revoke = (
  creatorId: string | null,
  id: string,
  headers: Record<string, string> = { origin: ORIGIN },
) =>
  handleRevoke(
    new Request(`https://take-studio.example/api/keys/${id}`, { method: "DELETE", headers }),
    id,
    deps(creatorId),
  );

describe("POST /api/keys (AC-1)", () => {
  it("creates a key: 201, the key once, only its hash stored, private no-store", async () => {
    const c = await createCreator(db);
    const res = await post(c.id, { name: "  my agent " });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.name).toBe("my agent");
    expect(body.key).toMatch(/^tsk_[A-Za-z0-9_-]{43}$/);
    expect(body.prefix).toBe(body.key.slice(4, 12));
    const [row] = await db.select().from(apiKey).where(eq(apiKey.id, body.id));
    expect(row?.creatorId).toBe(c.id);
    expect(row?.keyHash).toBe(await hashApiKey(body.key));
    expect(JSON.stringify(row)).not.toContain(body.key);
  });

  it("refuses a wrong Origin 403, no session 401, a bad body 422", async () => {
    const c = await createCreator(db);
    expect((await post(c.id, { name: "a" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(null, { name: "a" })).status).toBe(401);
    for (const bad of [
      { name: "" },
      { name: "   " },
      { name: "a".repeat(61) },
      {},
      { name: 5 },
      "nope",
    ]) {
      expect((await post(c.id, bad)).status).toBe(422);
    }
    expect((await post(c.id, { name: "a", creatorId: "x" })).status).toBe(422);
    expect(await db.select().from(apiKey).where(eq(apiKey.creatorId, c.id))).toHaveLength(0);
  });

  it("allows 5 keys and refuses a sixth with 409 key_limit; duplicate names are fine", async () => {
    const c = await createCreator(db);
    for (let i = 0; i < 5; i++) expect((await post(c.id, { name: "same" })).status).toBe(201);
    const sixth = await post(c.id, { name: "six" });
    expect(sixth.status).toBe(409);
    expect((await sixth.json()).error).toBe("key_limit");
  });

  it("never lets concurrent creates pass 5", async () => {
    const c = await createCreator(db);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => post(c.id, { name: `k${i}` })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(await db.select().from(apiKey).where(eq(apiKey.creatorId, c.id))).toHaveLength(5);
  });

  it("counts per creator: another creator's keys do not use up the limit", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    for (let i = 0; i < 5; i++) await post(a.id, { name: "a" });
    expect((await post(b.id, { name: "b" })).status).toBe(201);
  });
});

describe("GET /api/keys (AC-3)", () => {
  it("lists the creator's keys newest first with nothing secret, never another's", async () => {
    const c = await createCreator(db);
    const other = await createCreator(db);
    const first = await (await post(c.id, { name: "first" })).json();
    await new Promise((r) => setTimeout(r, 5));
    const second = await (await post(c.id, { name: "second" })).json();
    await post(other.id, { name: "theirs" });
    const res = await list(c.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const { keys } = JSON.parse(text);
    expect(keys.map((k: { id: string }) => k.id)).toEqual([second.id, first.id]);
    expect(Object.keys(keys[0]).sort()).toEqual([
      "createdAt",
      "id",
      "lastUsedAt",
      "name",
      "prefix",
    ]);
    expect(keys[0].lastUsedAt).toBeNull();
    expect(text).not.toContain(first.key);
    expect(text).not.toContain(second.key);
    expect(text).not.toContain(await hashApiKey(first.key));
  });

  it("is 401 without a session", async () => {
    expect((await list(null)).status).toBe(401);
  });
});

describe("DELETE /api/keys/{id} (AC-3)", () => {
  it("deletes the key: 204, then 404 on a repeat, and the row is gone", async () => {
    const c = await createCreator(db);
    const made = await (await post(c.id, { name: "x" })).json();
    const res = await revoke(c.id, made.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await db.select().from(apiKey).where(eq(apiKey.id, made.id))).toHaveLength(0);
    expect((await revoke(c.id, made.id)).status).toBe(404);
  });

  it("answers another creator's, a malformed and a missing ID with the same 404", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    const theirs = await (await post(a.id, { name: "theirs" })).json();
    const bodies = await Promise.all(
      [theirs.id, "not-a-uuid", crypto.randomUUID()].map(async (id) => {
        const res = await revoke(b.id, id);
        expect(res.status).toBe(404);
        return res.text();
      }),
    );
    expect(new Set(bodies).size).toBe(1);
    expect(await db.select().from(apiKey).where(eq(apiKey.id, theirs.id))).toHaveLength(1);
  });

  it("is 403 for a wrong Origin and 401 without a session", async () => {
    const c = await createCreator(db);
    const made = await (await post(c.id, { name: "x" })).json();
    expect((await revoke(c.id, made.id, { origin: "https://evil.example" })).status).toBe(403);
    expect((await revoke(null, made.id)).status).toBe(401);
    expect((await revoke(c.id, made.id, {})).status).toBe(403);
    expect(await db.select().from(apiKey).where(eq(apiKey.id, made.id))).toHaveLength(1);
  });
});

describe("session only (AC-4)", () => {
  it("answers 401 session_required to a bearer request, even beside a valid session", async () => {
    const c = await createCreator(db);
    const made = await (await post(c.id, { name: "x" })).json();
    const bearer = { authorization: `Bearer ${made.key}` };
    const created = await post(c.id, { name: "more" }, bearer);
    const listed = await list(c.id, bearer);
    const revoked = await revoke(c.id, made.id, { origin: ORIGIN, ...bearer });
    for (const res of [created, listed, revoked]) {
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("session_required");
    }
    // Any Authorization value counts, a malformed one too: the cookie is never read beside it.
    expect((await list(c.id, { authorization: "Basic abc" })).status).toBe(401);
    expect(await db.select().from(apiKey).where(eq(apiKey.creatorId, c.id))).toHaveLength(1);
  });

  it("still checks Origin first on writes", async () => {
    const c = await createCreator(db);
    const res = await post(
      c.id,
      { name: "a" },
      { origin: "https://evil.example", authorization: "Bearer x" },
    );
    expect(res.status).toBe(403);
  });
});

describe("private (AC-13)", () => {
  it("writes the raw key, its hash and its prefix to no log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const c = await createCreator(db);
      const made = await (await post(c.id, { name: "quiet" })).json();
      await list(c.id);
      await revoke(c.id, made.id);
      await post(c.id, { name: "a" }, { authorization: `Bearer ${made.key}` });
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain(made.key);
      expect(logged).not.toContain(made.key.slice(4));
      expect(logged).not.toContain(made.prefix);
      expect(logged).not.toContain(await hashApiKey(made.key));
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("returns the key in the create answer only", async () => {
    const c = await createCreator(db);
    const made = await (await post(c.id, { name: "once" })).json();
    expect(made.key).toBeDefined();
    const listed = await (await list(c.id)).text();
    expect(listed).not.toContain(made.key);
    expect(listed).not.toContain('key"');
  });
});

describe("POST /api/keys body size (CodeRabbit)", () => {
  it("refuses a body over 4 KB as invalid and makes no key", async () => {
    const c = await createCreator(db);
    const res = await post(c.id, { name: "a".repeat(10_000) });
    expect(res.status).toBe(422);
    expect(await db.select().from(apiKey).where(eq(apiKey.creatorId, c.id))).toHaveLength(0);
  });
});
