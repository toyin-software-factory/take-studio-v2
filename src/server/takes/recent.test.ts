import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { RECENT_TAKES_LIMIT, recentForCreator } from "./recent";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

describe("recentForCreator (the sidebar's recent takes)", () => {
  it("returns the newest five of this creator, newest first, with only what the shell shows", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const minute = 60_000;
    for (let i = 0; i < 7; i += 1) {
      await seedTake(db, creator.id, {
        title: `Take ${i}`,
        status: "ready",
        durationMs: 10_000 + i,
        createdAt: new Date(Date.now() - (10 - i) * minute),
      });
    }
    await seedTake(db, other.id, { title: "Someone else", createdAt: new Date() });

    const recent = await recentForCreator(db, creator.id);
    expect(recent).toHaveLength(RECENT_TAKES_LIMIT);
    expect(recent.map((t) => t.title)).toEqual(["Take 6", "Take 5", "Take 4", "Take 3", "Take 2"]);
    expect(Object.keys(recent[0]!).sort()).toEqual(["durationMs", "id", "status", "title"]);
    expect(recent[0]).toMatchObject({ status: "ready", durationMs: 10_006 });
  });

  it("is empty for a creator with no takes", async () => {
    const creator = await createCreator(db);
    expect(await recentForCreator(db, creator.id)).toEqual([]);
  });
});
