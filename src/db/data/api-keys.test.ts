import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apiKey, apiRateWindow, user } from "@/db/schema";
import { createCreator, openTestDb } from "@/db/testing/test-db";
import { generateApiKey, hashApiKey, apiKeyPrefix, rateWindowStart } from "@/lib/api-rules";
import { purgeOldRateWindows } from "./api-keys";

const test = await openTestDb({ database: "take_studio_test_api_keys" });
const { db } = test;
afterAll(async () => {
  await test.close();
});

async function makeKey(creatorId: string) {
  const key = generateApiKey();
  const [row] = await db
    .insert(apiKey)
    .values({ creatorId, name: "agent", prefix: apiKeyPrefix(key), keyHash: await hashApiKey(key) })
    .returning();
  if (!row) throw new Error("no key row");
  return { key, row };
}

describe("api_key table (AC-2)", () => {
  it("stores the hash and prefix, never the key, and the hash is unique", async () => {
    const c = await createCreator(db);
    const { key, row } = await makeKey(c.id);
    expect(JSON.stringify(row)).not.toContain(key);
    expect(row.keyHash).toBe(await hashApiKey(key));
    expect(row.lastUsedAt).toBeNull();
    await expect(
      db
        .insert(apiKey)
        .values({ creatorId: c.id, name: "dup", prefix: row.prefix, keyHash: row.keyHash }),
    ).rejects.toThrow();
  });
});

describe("account deletion (AC-14)", () => {
  it("removes the creator's keys and their rate windows", async () => {
    const c = await createCreator(db);
    const other = await createCreator(db);
    const mine = await makeKey(c.id);
    const theirs = await makeKey(other.id);
    const start = rateWindowStart(new Date());
    await db.insert(apiRateWindow).values([
      { keyId: mine.row.id, windowStart: start, count: 3 },
      { keyId: theirs.row.id, windowStart: start, count: 1 },
    ]);
    await db.delete(user).where(eq(user.id, c.id));
    expect(await db.select().from(apiKey).where(eq(apiKey.id, mine.row.id))).toHaveLength(0);
    expect(
      await db.select().from(apiRateWindow).where(eq(apiRateWindow.keyId, mine.row.id)),
    ).toHaveLength(0);
    expect(await db.select().from(apiKey).where(eq(apiKey.id, theirs.row.id))).toHaveLength(1);
    expect(
      await db.select().from(apiRateWindow).where(eq(apiRateWindow.keyId, theirs.row.id)),
    ).toHaveLength(1);
  });
});

describe("purgeOldRateWindows (AC-9)", () => {
  it("deletes windows older than an hour in batches and keeps recent ones", async () => {
    const c = await createCreator(db);
    const { row } = await makeKey(c.id);
    const now = new Date("2026-11-14T12:00:30Z");
    const minute = (ago: number) => new Date(rateWindowStart(now).getTime() - ago * 60_000);
    await db.insert(apiRateWindow).values([
      { keyId: row.id, windowStart: minute(0), count: 5 },
      { keyId: row.id, windowStart: minute(30), count: 5 },
      { keyId: row.id, windowStart: minute(61), count: 5 },
      { keyId: row.id, windowStart: minute(90), count: 5 },
      { keyId: row.id, windowStart: minute(300), count: 5 },
    ]);
    expect(await purgeOldRateWindows(db, now, 2)).toBe(2);
    expect(await purgeOldRateWindows(db, now, 2)).toBe(1);
    expect(await purgeOldRateWindows(db, now, 2)).toBe(0);
    const left = await db.select().from(apiRateWindow).where(eq(apiRateWindow.keyId, row.id));
    expect(left).toHaveLength(2);
  });
});
