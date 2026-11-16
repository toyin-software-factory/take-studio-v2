import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realtimeTokenMint } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { REALTIME_TOKEN } from "@/lib/realtime-rules";
import { type RealtimeHttpDeps, handleToken } from "./http";

/**
 * Spec 0021 step 2, mint slots (B2-T161): a failed grant gives its slot back, and a refused mint
 * answers Retry-After from the oldest counted mint. Real handler and database, grant mocked.
 */
const ORIGIN = "https://take-studio.example";
const NOW = new Date("2026-11-10T12:00:00Z");
let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_realtime_slots" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

function deps(creatorId: string, grant?: () => Promise<Response>): RealtimeHttpDeps {
  const fetchMock = vi.fn(
    grant ?? (async () => Response.json({ access_token: "jwt-for-tests-only", expires_in: 60 })),
  );
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => ({ db, creatorId }),
    deepgramKey: () => "dg-realtime-key-for-tests",
    now: () => NOW,
    fetch: fetchMock as unknown as typeof fetch,
  };
}

const call = (d: RealtimeHttpDeps) =>
  handleToken(
    new Request("https://take-studio.example/api/realtime/token", {
      method: "POST",
      headers: { origin: ORIGIN },
    }),
    d,
  );

describe("POST /api/realtime/token mint slots", () => {
  it("gives the slot back when the grant fails, so failed grants never count", async () => {
    const c = await createCreator(db);
    const failing = vi.fn(async () => new Response("no", { status: 502 }));
    for (let i = 0; i < REALTIME_TOKEN.perHour + 2; i++) {
      const res = await call(deps(c.id, failing));
      expect(res.status).toBe(503);
    }
    const thrown = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect((await call(deps(c.id, thrown))).status).toBe(503);
    const odd = vi.fn(async () => Response.json({ access_token: "" }));
    expect((await call(deps(c.id, odd))).status).toBe(503);
    const rows = () =>
      db.select().from(realtimeTokenMint).where(eq(realtimeTokenMint.creatorId, c.id));
    expect(await rows()).toEqual([]);
    // A good grant still counts, and all ten of them still fit.
    for (let i = 0; i < REALTIME_TOKEN.perHour; i++) {
      expect((await call(deps(c.id))).status).toBe(200);
    }
    expect(await rows()).toHaveLength(REALTIME_TOKEN.perHour);
  });

  it("answers Retry-After as the time until the oldest counted mint leaves the hour", async () => {
    const c = await createCreator(db);
    const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60 * 1000);
    await db.insert(realtimeTokenMint).values(
      // The oldest is 50 minutes old, the rest are newer; one more than an hour old is not counted.
      [50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 90].map((m) => ({ creatorId: c.id, mintedAt: at(m) })),
    );
    const res = await call(deps(c.id));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(10 * 60));
  });
});
