import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb } from "../testing/test-db";
import { withJobDb } from "./job";
import { createWebDb } from "./web";

/**
 * The two database client factories (spec 0001, Runtime rules): a per request web client and
 * a job client opened and closed inside each task, with a retry on the first connect.
 * Runs against the local test Postgres (localhost only).
 */
const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/take_studio_test";

beforeAll(async () => {
  // Creates and migrates the test database when needed.
  const testDb = await openTestDb();
  await testDb.close();
});

describe("withJobDb", () => {
  it("runs the callback against the database and returns its result", async () => {
    const value = await withJobDb(TEST_URL, async (db) => {
      const [row] = await db.execute<{ one: number }>(sql`select 1 as one`);
      return row?.one;
    });
    expect(value).toBe(1);
  });

  it("closes its client when the callback finishes, even when it throws", async () => {
    let leaked: Parameters<Parameters<typeof withJobDb>[1]>[0] | undefined;
    await expect(
      withJobDb(TEST_URL, async (db) => {
        leaked = db;
        throw new Error("task failed");
      }),
    ).rejects.toThrow("task failed");
    await expect(leaked?.execute(sql`select 1`)).rejects.toThrow();
  });

  it("retries the first connect, then gives up after 3 attempts", { timeout: 30_000 }, async () => {
    // Nothing listens on this port: every connect is refused at once.
    const started = Date.now();
    await expect(
      withJobDb("postgres://postgres:postgres@127.0.0.1:1/none", async () => "never"),
    ).rejects.toThrow();
    // Waits 1 s then 2 s between the three attempts; a small margin absorbs timer drift.
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_900);
  });
});

describe("createWebDb", () => {
  it("creates a separate client per call (never a shared module level client)", async () => {
    const first = createWebDb({ connectionString: TEST_URL });
    const second = createWebDb({ connectionString: TEST_URL });
    expect(first).not.toBe(second);
    const [row] = await first.execute<{ one: number }>(sql`select 1 as one`);
    expect(row?.one).toBe(1);
    await first.$client.end({ timeout: 5 });
    await second.$client.end({ timeout: 5 });
  });
});
