import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { failAbandonedUploads, recoverStuckUploads } from "./cleanup";
import { NOW, minutes, notStored } from "./cleanup-test-helpers";

/**
 * These sweep whole tables, so they use their own database and start each test empty.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup_7" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
beforeEach(async () => {
  await db.delete(take);
  await db.delete(storageDeletion);
});
describe("cleanup: takes stuck in uploading after a failed probe dispatch (S1C-T09)", () => {
  /** An `uploading` take quiet for `quiet` minutes, created `age` minutes ago. */
  async function seedStuck(
    creatorId: string,
    values: Partial<typeof take.$inferInsert> = {},
    age = 30,
    quiet = 10,
  ) {
    return seedTake(db, creatorId, {
      status: "uploading",
      uploadId: "upload-1",
      durationMs: null,
      videoExpiresAt: null,
      createdAt: minutes(age),
      updatedAt: minutes(quiet),
      ...values,
    });
  }

  function ports(options: { stored?: boolean; headFails?: boolean; dispatchFails?: boolean } = {}) {
    const dispatched: { takeId: string; redispatch: number }[] = [];
    return {
      dispatched,
      headObject: async (_key: string) => {
        if (options.headFails) throw new Error("r2 down");
        return options.stored === false ? null : { size: 1_000_000 };
      },
      dispatchProbe: async (takeId: string, redispatch: number) => {
        dispatched.push({ takeId, redispatch });
        if (options.dispatchFails) throw new Error("trigger down");
      },
    };
  }

  const probeAttemptsOf = async (id: string) =>
    (await db.select().from(take).where(eq(take.id, id)))[0]!;

  it("moves a take whose storage check failed behind the others, so it cannot starve them", async () => {
    const creator = await createCreator(db);
    const broken = await seedStuck(creator.id, {}, 60, 30); // oldest updated_at
    const fine = await seedStuck(creator.id, {}, 50, 10);
    const base = ports();
    const p = {
      ...base,
      headObject: async (key: string) => {
        if (key === broken.originalKey) throw new Error("r2 error");
        return base.headObject(key);
      },
    };
    const result = await recoverStuckUploads(db, NOW, p);
    expect(result.redispatched).toEqual([fine.id]);
    // The broken one was touched: it now sorts after everything that was waiting.
    expect((await probeAttemptsOf(broken.id)).updatedAt.getTime()).toBe(NOW.getTime());
    expect((await probeAttemptsOf(broken.id)).status).toBe("uploading");
  });

  it("stops starting storage checks when the time budget is used up", async () => {
    const creator = await createCreator(db);
    for (let n = 0; n < 3; n += 1) await seedStuck(creator.id, {}, 60 - n, 30 - n);
    let ticks = 0;
    const clock = () => (ticks += 600); // each look at the clock costs 600 ms
    const p = ports();
    const result = await recoverStuckUploads(db, NOW, p, { budgetMs: 1000, clock });
    expect(result.redispatched).toHaveLength(1); // the rest wait for the next run
    expect(p.dispatched).toHaveLength(1);
    let t2 = 0;
    const abandoned = await failAbandonedUploads(db, NOW, notStored, {
      budgetMs: 0,
      clock: () => (t2 += 1),
    });
    expect(abandoned).toEqual([]); // no time left: nothing was started
  });
});
