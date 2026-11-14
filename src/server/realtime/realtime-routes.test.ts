import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { purgeOldMints } from "@/db/data/realtime-mints";
import { appSetting, realtimeTokenMint, usageMonth } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { chargedMonth } from "@/lib/billing";
import { REALTIME_TOKEN } from "@/lib/realtime-rules";
import { usageAccountHash } from "@/lib/usage-hash";
import { type RealtimeHttpDeps, handleToken } from "./http";

/**
 * Spec 0021 step 2 (AC-12, server side; AC-11 for the key's copy is in the legal tests): the
 * token route through the real handler and a real database, with Deepgram's grant mocked.
 * Own database: `app_setting` is global.
 */
const ORIGIN = "https://take-studio.example";
const SECRET = "x".repeat(40);
const KEY = "dg-realtime-key-for-tests";
const TOKEN = "jwt-for-tests-only";
const NOW = new Date("2026-11-10T12:00:00Z");
let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_realtime_routes" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

async function setLimit(enabled: boolean): Promise<void> {
  for (const row of [
    { key: "usage_limit_enabled", value: enabled },
    { key: "free_monthly_seconds", value: 100 },
  ]) {
    await db
      .insert(appSetting)
      .values(row)
      .onConflictDoUpdate({ target: appSetting.key, set: { value: row.value } });
  }
}
beforeEach(() => setLimit(false));

const grantOk = () => vi.fn(async () => Response.json({ access_token: TOKEN, expires_in: 60 }));

function deps(
  creatorId: string | null,
  extra: Partial<RealtimeHttpDeps> = {},
): RealtimeHttpDeps & { fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = grantOk();
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    deepgramKey: () => KEY,
    usageSecret: () => SECRET,
    now: () => NOW,
    fetch: fetchMock as unknown as typeof fetch,
    ...extra,
  } as RealtimeHttpDeps & { fetch: ReturnType<typeof vi.fn> };
}

const call = (d: RealtimeHttpDeps, headers: Record<string, string> = { origin: ORIGIN }) =>
  handleToken(
    new Request("https://take-studio.example/api/realtime/token", { method: "POST", headers }),
    d,
  );

describe("POST /api/realtime/token", () => {
  it("mints through Deepgram's grant: 200, the token, private no-store", async () => {
    const c = await createCreator(db);
    const d = deps(c.id);
    const res = await call(d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ token: TOKEN, expiresInSeconds: 60 });
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepgram.com/v1/auth/grant");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Token ${KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({ ttl_seconds: REALTIME_TOKEN.ttlSeconds });
  });

  it("refuses a bad or missing Origin (403) before anything else", async () => {
    const c = await createCreator(db);
    const d = deps(c.id);
    expect((await call(d, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(d, {})).status).toBe(403);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("needs a session (401) and refuses an API key (401 session_required)", async () => {
    const c = await createCreator(db);
    expect((await call(deps(null))).status).toBe(401);
    const res = await call(deps(c.id), { origin: ORIGIN, authorization: "Bearer tsk_x" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("session_required");
  });

  it("is a friendly 503 and takes no slot when the separate key is not set", async () => {
    const c = await createCreator(db);
    const d = deps(c.id, { deepgramKey: () => null });
    const res = await call(d);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("unavailable");
    expect(d.fetch).not.toHaveBeenCalled();
    expect(
      await db.select().from(realtimeTokenMint).where(eq(realtimeTokenMint.creatorId, c.id)),
    ).toEqual([]);
  });

  it("allows 10 an hour per creator, then 429 with Retry-After, and the refusal writes nothing", async () => {
    const c = await createCreator(db);
    for (let i = 0; i < REALTIME_TOKEN.perHour; i++) {
      expect((await call(deps(c.id))).status).toBe(200);
    }
    const d = deps(c.id);
    const res = await call(d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect((await res.json()).error).toBe("rate_limited");
    expect(d.fetch).not.toHaveBeenCalled();
    const rows = await db
      .select()
      .from(realtimeTokenMint)
      .where(eq(realtimeTokenMint.creatorId, c.id));
    expect(rows).toHaveLength(REALTIME_TOKEN.perHour);
    // Another creator is not affected.
    const other = await createCreator(db);
    expect((await call(deps(other.id))).status).toBe(200);
  });

  it("frees the hourly slots after an hour and stops at the daily cap", async () => {
    const c = await createCreator(db);
    // 40 mints spread over the last day (4 an hour at 2 hours ago and earlier).
    const rows = Array.from({ length: REALTIME_TOKEN.perDay }, (_, i) => ({
      creatorId: c.id,
      mintedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000 - i * 60 * 1000),
    }));
    await db.insert(realtimeTokenMint).values(rows);
    const res = await call(deps(c.id));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("86400");
    // A day later the window has moved past them.
    const later = deps(c.id, { now: () => new Date(NOW.getTime() + 25 * 60 * 60 * 1000) });
    expect((await call(later)).status).toBe(200);
  });

  it("refuses with limit_exceeded when the limit is on and nothing is left, never minting", async () => {
    await setLimit(true);
    const c = await createCreator(db);
    await db.insert(usageMonth).values({
      accountHash: await usageAccountHash(c.email, SECRET),
      month: chargedMonth(NOW),
      secondsUsed: 100,
      hashVersion: 1,
    });
    const d = deps(c.id);
    const res = await call(d);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("limit_exceeded");
    expect(body.remainingSeconds).toBe(0);
    expect(d.fetch).not.toHaveBeenCalled();
    // With minutes left, or the limit off, it mints.
    const fresh = await createCreator(db);
    expect((await call(deps(fresh.id))).status).toBe(200);
    await setLimit(false);
    expect((await call(deps(c.id))).status).toBe(200);
  });

  it("refuses with 503 and never mints when the usage read fails", async () => {
    const c = await createCreator(db);
    const d = deps(c.id);
    const broken = {
      ...d,
      getCreator: async () => ({ db: {} as typeof db, creatorId: c.id }),
    };
    const res = await call(broken);
    expect(res.status).toBe(503);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("answers 503 and logs a code only when Deepgram fails, never the token or the key", async () => {
    const c = await createCreator(db);
    const log = vi.fn();
    const failing = vi.fn(async () => new Response(`secret ${KEY} ${TOKEN}`, { status: 402 }));
    const res = await call(deps(c.id, { fetch: failing as unknown as typeof fetch, log }));
    expect(res.status).toBe(503);
    expect(log).toHaveBeenCalledWith("realtime token grant failed", { reason: "status_402" });
    expect(JSON.stringify([...log.mock.calls, await res.text()])).not.toMatch(
      new RegExp(`${KEY}|${TOKEN}`),
    );
    const thrown = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect((await call(deps(c.id, { fetch: thrown as unknown as typeof fetch, log }))).status).toBe(
      503,
    );
    const odd = vi.fn(async () => Response.json({ access_token: "" }));
    expect((await call(deps(c.id, { fetch: odd as unknown as typeof fetch, log }))).status).toBe(
      503,
    );
  });

  it("purges mint rows older than two days and keeps newer ones", async () => {
    const c = await createCreator(db);
    await db.insert(realtimeTokenMint).values([
      { creatorId: c.id, mintedAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000) },
      { creatorId: c.id, mintedAt: new Date(NOW.getTime() - 60 * 60 * 1000) },
    ]);
    expect(await purgeOldMints(db, NOW)).toBeGreaterThanOrEqual(1);
    const left = await db
      .select()
      .from(realtimeTokenMint)
      .where(eq(realtimeTokenMint.creatorId, c.id));
    expect(left).toHaveLength(1);
  });
});
