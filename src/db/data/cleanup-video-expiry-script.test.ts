import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storageDeletion, take } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { expireDueTakes } from "./cleanup";
import { NOW, minutes } from "./cleanup-test-helpers";

/** Spec 0021 AC-8: the script is kept when the video expires, like the transcript. Own database: it sweeps whole tables. */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cleanup_script" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
beforeEach(async () => {
  await db.delete(take);
  await db.delete(storageDeletion);
});

describe("video expiry and the take script (spec 0021 AC-8)", () => {
  it("expires the video but keeps the script and the source", async () => {
    const creator = await createCreator(db);
    const due = await seedTake(db, creator.id, {
      status: "ready",
      videoExpiresAt: minutes(1),
      script: "Synthetic script line one.",
      source: "recording",
    });
    await expireDueTakes(db, NOW);
    const [row] = await db.select().from(take).where(eq(take.id, due.id));
    expect(row).toMatchObject({
      status: "expired",
      script: "Synthetic script line one.",
      source: "recording",
    });
  });
});
