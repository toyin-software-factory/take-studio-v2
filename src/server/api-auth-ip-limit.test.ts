import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { bearerFailWindow } from "@/db/schema";
import {
  createApiKey,
  purgeAllOldBearerFailures,
  purgeOldBearerFailures,
} from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import {
  BEARER_FAIL,
  apiKeyPrefix,
  clientIpOf,
  generateApiKey,
  hashApiKey,
  hashClientIp,
} from "@/lib/api-rules";
import { type ApiAuthDeps, resolveCreator } from "./api-auth";

/** B2-T103: a per address limit on wrong or malformed bearer values, in front of the lookup. */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_auth_ip" });
  db = testDb.db;
  // The test database outlives a run and the clock here is fixed: start from no counts.
  await db.delete(bearerFailWindow);
});
afterAll(() => testDb?.close());

const NOW = new Date("2026-11-14T10:20:30Z");
const deps = (): Pick<ApiAuthDeps, "getCreator" | "keyAuth"> => ({
  getCreator: async () => null,
  keyAuth: { getDb: async () => db, now: () => NOW },
});
const call = (bearer: string, ip: string | null) =>
  resolveCreator(
    new Request("https://take-studio.example/api/usage", {
      headers: { authorization: bearer, ...(ip ? { "cf-connecting-ip": ip } : {}) },
    }),
    deps(),
  );
const rows = async (ip: string) =>
  db
    .select()
    .from(bearerFailWindow)
    .where(eq(bearerFailWindow.ipHash, await hashClientIp(ip)));

describe("a flood of wrong bearers from one address", () => {
  it("is 401 up to the limit, then 429 with Retry-After, and the lookup stops", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < BEARER_FAIL.perMinute; i++) {
      const out = await call(`Bearer tsk_${"a".repeat(42)}${i % 10}`, ip);
      expect(out.ok === false && out.error.kind).toBe("invalid_api_key");
    }
    const blocked = await call(`Bearer tsk_${"b".repeat(43)}`, ip);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toEqual({ kind: "rate_limited", retryAfter: 30 });
    // Blocked requests are not counted again: the table stops growing.
    expect((await rows(ip))[0]?.count).toBe(BEARER_FAIL.perMinute);
  });

  it("admits only the budget when 100 wrong requests arrive at the same moment", async () => {
    const ip = "203.0.113.13";
    const outs = await Promise.all(
      Array.from({ length: 100 }, (_, i) => call(`Bearer nope${i}`, ip)),
    );
    const kinds = outs.map((o) => (o.ok ? "ok" : o.error.kind));
    expect(kinds.filter((k) => k === "invalid_api_key")).toHaveLength(BEARER_FAIL.perMinute);
    expect(kinds.filter((k) => k === "rate_limited")).toHaveLength(100 - BEARER_FAIL.perMinute);
    expect((await rows(ip))[0]?.count).toBe(BEARER_FAIL.perMinute);
  });

  it("counts malformed values and unknown OAuth tokens too", async () => {
    const ip = "203.0.113.11";
    await call("Bearer nonsense", ip);
    await call("Basic abc", ip);
    await call("", ip);
    expect((await rows(ip))[0]?.count).toBe(3);
  });

  it("starts again in the next minute", async () => {
    const ip = "203.0.113.12";
    for (let i = 0; i < BEARER_FAIL.perMinute; i++) await call("Bearer nope", ip);
    expect((await call("Bearer nope", ip)).ok).toBe(false);
    const later = {
      ...deps(),
      keyAuth: { getDb: async () => db, now: () => new Date(NOW.getTime() + 60_000) },
    };
    const out = await resolveCreator(
      new Request("https://take-studio.example/api/usage", {
        headers: { authorization: "Bearer nope", "cf-connecting-ip": ip },
      }),
      later,
    );
    expect(out.ok === false && out.error.kind).toBe("invalid_api_key");
  });
});

describe("good clients and other addresses", () => {
  it("a valid key from the same address works below the limit and is never counted", async () => {
    const ip = "203.0.113.20";
    const { id: creatorId } = await createCreator(db);
    const key = generateApiKey();
    const made = await createApiKey(db, {
      creatorId,
      name: "agent",
      prefix: apiKeyPrefix(key),
      keyHash: await hashApiKey(key),
    });
    expect(made.ok).toBe(true);
    for (let i = 0; i < BEARER_FAIL.perMinute - 1; i++) await call("Bearer nope", ip);
    for (let i = 0; i < 5; i++) {
      const out = await call(`Bearer ${key}`, ip);
      expect(out.ok && out.data.creatorId).toBe(creatorId);
    }
    expect((await rows(ip))[0]?.count).toBe(BEARER_FAIL.perMinute - 1);
  });

  it("another address is not affected by a flood", async () => {
    for (let i = 0; i < BEARER_FAIL.perMinute + 2; i++) await call("Bearer nope", "203.0.113.30");
    const out = await call("Bearer nope", "203.0.113.31");
    expect(out.ok === false && out.error.kind).toBe("invalid_api_key");
  });

  it("with no address header nothing is stored or limited", async () => {
    for (let i = 0; i < BEARER_FAIL.perMinute + 2; i++) {
      const out = await call("Bearer nope", null);
      expect(out.ok === false && out.error.kind).toBe("invalid_api_key");
    }
  });
});

describe("what is stored and logged", () => {
  it("keeps only a hash of the address and never logs the address or the bearer", async () => {
    const ip = "198.51.100.77";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = `tsk_${"z".repeat(43)}`;
    for (let i = 0; i < BEARER_FAIL.perMinute + 1; i++) await call(`Bearer ${secret}`, ip);
    const logged = JSON.stringify(warn.mock.calls);
    warn.mockRestore();
    expect(logged).not.toContain(ip);
    expect(logged).not.toContain(secret);
    expect(logged).toContain("api_bearer_ip_limited");
    const all = JSON.stringify(await db.select().from(bearerFailWindow));
    expect(all).not.toContain(ip);
    expect((await rows(ip))[0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("clientIpOf accepts an address only", () => {
    const h = (v: string) => new Headers({ "cf-connecting-ip": v });
    expect(clientIpOf(h("203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIpOf(h("2001:DB8::1"))).toBe("2001:db8::1");
    expect(clientIpOf(h("1.2.3.4, 5.6.7.8"))).toBeNull();
    expect(clientIpOf(h("x".repeat(500)))).toBeNull();
    expect(clientIpOf(new Headers())).toBeNull();
  });
});

describe("the purge", () => {
  it("deletes rows older than an hour in batches and keeps the rest", async () => {
    const old = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    await db.insert(bearerFailWindow).values([
      { ipHash: "old1", windowStart: old, count: 3 },
      { ipHash: "old2", windowStart: old, count: 3 },
      { ipHash: "old3", windowStart: old, count: 3 },
    ]);
    expect(await purgeOldBearerFailures(db, NOW, 2)).toBe(2);
    expect(await purgeOldBearerFailures(db, NOW, 2)).toBe(1);
    expect(await purgeOldBearerFailures(db, NOW, 2)).toBe(0);
    expect((await db.select().from(bearerFailWindow)).length).toBeGreaterThan(0);
  });

  it("purgeAll keeps going past one batch until nothing old is left", async () => {
    const old = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
    await db.insert(bearerFailWindow).values(
      Array.from({ length: 1500 }, (_, i) => ({
        ipHash: `bulk${i}`,
        windowStart: old,
        count: 1,
      })),
    );
    expect(await purgeAllOldBearerFailures(db, NOW)).toBe(1500);
    expect(await purgeAllOldBearerFailures(db, NOW)).toBe(0);
  });
});
