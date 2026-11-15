import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apiKey } from "@/db/schema";
import { createApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { type ApiAuthDeps } from "./api-auth";
import { ORIGIN, bearer, noSession, type Session, usage } from "./api-auth-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_auth_3" });
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
describe("last used on a 429 (B2-T104)", () => {
  it(
    "does not move last_used_at when the request is rate limited",
    { timeout: 30_000 },
    async () => {
      const c = await createCreator(db);
      const { key, id } = await makeKey(c.id);
      const deps = authDeps(noSession(), () => new Date("2026-11-14T15:00:30.000Z"));
      for (let i = 0; i < 120; i++) await usage(deps, bearer(key));
      const old = new Date(Date.now() - 2 * 3600_000);
      await db.update(apiKey).set({ lastUsedAt: old }).where(eq(apiKey.id, id));
      const over = await usage(deps, bearer(key));
      expect(over.status).toBe(429);
      const [row] = await db.select().from(apiKey).where(eq(apiKey.id, id));
      expect(row?.lastUsedAt).toEqual(old);
    },
  );
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
