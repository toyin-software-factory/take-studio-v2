import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appSetting, render } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { SECRET } from "./background-job-test-helpers";
import { decideCredit } from "./credit";
import { startJob } from "./jobs";
import { create as createRender, markUncredited } from "./renders";

// Spec 0026 AC-4, AC-5: the credit is decided inside createRender, from the settings and the take.

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_credit" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

async function setting(key: string, value: unknown) {
  await db
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSetting.key, set: { value } });
}
const configure = (enabled: boolean, startsAt: string) =>
  Promise.all([setting("credit_enabled", enabled), setting("credit_starts_at", startsAt)]);
beforeEach(() => configure(false, ""));

async function renderFor(createdAt?: Date) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { durationMs: 10_000, ...(createdAt && { createdAt }) });
  const started = await startJob(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET });
  if (!started.ok) throw new Error("job did not start");
  const made = await createRender(db, { takeId: t.id, jobId: started.data.id });
  if (!made.ok) throw new Error("render not created");
  return { render: made.data, take: t };
}

describe("creating a render decides the credit", () => {
  it("is off by default: the seeded settings leave a render unchanged", async () => {
    // The test database outlives a run and the tests below change the setting, so the default
    // is read from the migration itself, not from a row a fixture may have written.
    const dir = join(process.cwd(), "drizzle");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .find((text) => text.includes("'credit_enabled'"));
    expect(sql).toMatch(/\('credit_enabled', 'false'::jsonb\)/);
    expect((await renderFor()).render.creditApplied).toBe(false);
  });

  it("credits a free take created after the start once the switch is on", async () => {
    await configure(true, "2020-01-01T00:00:00Z");
    expect((await renderFor()).render.creditApplied).toBe(true);
  });

  it("leaves a take created before the start alone, and a switch that is off", async () => {
    await configure(true, new Date(Date.now() + 86_400_000).toISOString());
    expect((await renderFor()).render.creditApplied).toBe(false);
    await configure(true, "2026-01-01T00:00:00Z");
    expect((await renderFor(new Date("2025-06-01T00:00:00Z"))).render.creditApplied).toBe(false);
    await configure(false, "2020-01-01T00:00:00Z");
    expect((await renderFor()).render.creditApplied).toBe(false);
  });

  it("reads a failed settings query as no credit, and the render goes on", async () => {
    await configure(true, "2020-01-01T00:00:00Z");
    const broken = {
      transaction: () => Promise.reject(new Error("db down")),
    } as unknown as Db;
    expect(await decideCredit(broken, { takeId: "any", now: new Date() })).toBe(false);
  });
});

describe("markUncredited", () => {
  it("clears the flag on a pending render only", async () => {
    await configure(true, "2020-01-01T00:00:00Z");
    const { render: made } = await renderFor();
    expect(made.creditApplied).toBe(true);
    const marked = await markUncredited(db, { renderId: made.id });
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.data.creditApplied).toBe(false);
    await db.update(render).set({ status: "succeeded" }).where(eq(render.id, made.id));
    await db.update(render).set({ creditApplied: true }).where(eq(render.id, made.id));
    expect((await markUncredited(db, { renderId: made.id })).ok).toBe(false);
  });
});
