import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobStep, processingJob } from "./index";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";

/**
 * HRF-T08: migration 0007 adds the `background` kind and gives old background changes (once
 * recognised by hidden rules) the new kind. This runs its backfill statement on real rows.
 */
let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb();
});
afterAll(() => testDb?.close());

const migration = readFileSync(
  new URL("../../../drizzle/0007_background_job_kind.sql", import.meta.url),
  "utf8",
);
const statements = migration.split("--> statement-breakpoint").map((s) => s.trim());
const backfill = statements.find((s) => s.includes("UPDATE"))!;

async function job(opts: {
  takeStatus: "ready" | "processing";
  status: "queued" | "running" | "succeeded" | "failed";
  steps: readonly string[];
  kind?: "initial" | "rerender";
}) {
  const { db } = testDb;
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: opts.takeStatus });
  const id = crypto.randomUUID();
  await db.insert(processingJob).values({
    id,
    takeId: t.id,
    kind: opts.kind ?? "rerender",
    status: opts.status,
    secondsCharged: 0,
  });
  for (const [position, name] of opts.steps.entries()) {
    await db.insert(jobStep).values({
      id: crypto.randomUUID(),
      jobId: id,
      name,
      position,
      status: "pending",
      progress: 0,
    });
  }
  return id;
}

describe("migration 0007 (background job kind)", () => {
  it("allows the new kind in the CHECK and keeps the old ones", () => {
    expect(migration).toContain(
      `IN ('initial', 'rerender', 'background', 'transcribe', 'reanalyse')`,
    );
  });

  it("backfills FINISHED background changes by the old no trim rule, never a queued or running row", async () => {
    const { db } = testDb;
    const activeBackground = await job({
      takeStatus: "ready",
      status: "running",
      steps: ["background", "render"],
    });
    const queuedBackground = await job({
      takeStatus: "ready",
      status: "queued",
      steps: ["background", "render"],
    });
    const activeReRender = await job({
      takeStatus: "processing",
      status: "running",
      steps: ["trim", "background", "render"],
    });
    const finishedBackground = await job({
      takeStatus: "ready",
      status: "succeeded",
      steps: ["background", "render"],
    });
    const failedBackground = await job({
      takeStatus: "ready",
      status: "failed",
      steps: ["render"],
    });
    const finishedReRender = await job({
      takeStatus: "ready",
      status: "succeeded",
      steps: ["trim", "background", "render"],
    });
    const initial = await job({
      takeStatus: "ready",
      status: "succeeded",
      steps: ["trim", "render"],
      kind: "initial",
    });
    const ids = [
      activeBackground,
      queuedBackground,
      activeReRender,
      finishedBackground,
      failedBackground,
      finishedReRender,
      initial,
    ];

    await db.execute(sql.raw(backfill));

    const rows = await db
      .select({ id: processingJob.id, kind: processingJob.kind })
      .from(processingJob)
      .where(inArray(processingJob.id, ids));
    const kind = (id: string) => rows.find((r) => r.id === id)?.kind;
    expect(kind(finishedBackground)).toBe("background");
    expect(kind(failedBackground)).toBe("background");
    // An older process-take may still be running these as `rerender`: never touched.
    expect(kind(activeBackground)).toBe("rerender");
    expect(kind(queuedBackground)).toBe("rerender");
    expect(kind(activeReRender)).toBe("rerender");
    expect(kind(finishedReRender)).toBe("rerender");
    expect(kind(initial)).toBe("initial");

    // Running it again changes nothing (the statement is safe to repeat).
    await db.execute(sql.raw(backfill));
    const again = await db
      .select({ id: processingJob.id, kind: processingJob.kind })
      .from(processingJob)
      .where(eq(processingJob.id, activeBackground));
    expect(again[0]?.kind).toBe("rerender");
  });
});
