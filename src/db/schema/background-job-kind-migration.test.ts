import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingJob } from "./index";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";

/**
 * Migration 0007 lets `processing_job.kind` be `background`. A dedicated database, since
 * the test inserts jobs of every kind (the shared one is used by many suites).
 */
let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_background_job_kind_migration" });
});
afterAll(() => testDb?.close());

const migration = readFileSync(
  new URL("../../../drizzle/0007_background_job_kind.sql", import.meta.url),
  "utf8",
);

describe("migration 0007 (background job kind)", () => {
  it("replaces the CHECK with a superset: the old kinds stay, `background` is added", () => {
    expect(migration).toContain(
      `IN ('initial', 'rerender', 'background', 'transcribe', 'reanalyse')`,
    );
  });

  it("changes no row: there is no backfill, because a rerender cannot be told apart afterwards", () => {
    expect(migration).not.toMatch(/\bUPDATE\b\s+"processing_job"/i);
  });

  it("accepts a job of every kind, and refuses an unknown one", async () => {
    const { db } = testDb;
    const creator = await createCreator(db);
    for (const kind of ["initial", "rerender", "background", "transcribe", "reanalyse"] as const) {
      const t = await seedTake(db, creator.id, { status: "ready" });
      const id = crypto.randomUUID();
      await db
        .insert(processingJob)
        .values({ id, takeId: t.id, kind, status: "succeeded", secondsCharged: 0 });
      const [row] = await db.select().from(processingJob).where(eq(processingJob.id, id));
      expect(row?.kind).toBe(kind);
    }
    const t = await seedTake(db, creator.id, { status: "ready" });
    await expect(
      db.insert(processingJob).values({
        id: crypto.randomUUID(),
        takeId: t.id,
        kind: "something_else" as never,
        status: "succeeded",
        secondsCharged: 0,
      }),
    ).rejects.toThrow();
  });
});
