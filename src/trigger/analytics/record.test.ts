import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { analyticsEvent, cut, jobStep, processingJob } from "@/db/schema";
import { createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import { recordJobEvent, recordTakeFailed, recordTakeReady } from "./record";

vi.mock("@trigger.dev/sdk", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

const test = await openTestDb({ database: "take_studio_test_analytics" });
const { db } = test;
const named = (takeId: string, name: string) =>
  db
    .select()
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.takeId, takeId), eq(analyticsEvent.name, name)));

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
  await test.close();
});

async function readyJob(
  step: { status: string; failureCode?: string } | null,
  kind = "initial",
  aiCuts = 0,
) {
  const c = await createCreator(db);
  const t = await seedTake(db, c.id, { status: "ready" });
  const job = { id: crypto.randomUUID(), kind };
  await db
    .insert(processingJob)
    .values({ id: job.id, takeId: t.id, kind, status: "succeeded", secondsCharged: 1 });
  if (step) {
    await db.insert(jobStep).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      name: "ai_edit",
      position: 1,
      status: step.status,
      failureCode: step.failureCode ?? null,
    });
  }
  for (let i = 0; i < aiCuts; i++) {
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      startMs: i * 1000,
      endMs: i * 1000 + 500,
      kind: "filler",
      proposedBy: "ai",
    });
  }
  return { c, t, job };
}

describe("job events (spec 0016, AC-4, AC-6)", () => {
  it("records take_ready done plus ai_edit_used from the persisted step row, once", async () => {
    const { c, t, job } = await readyJob({ status: "succeeded" }, "initial", 2);
    await recordTakeReady(db, job, { id: t.id, creatorId: c.id });
    await recordTakeReady(db, job, { id: t.id, creatorId: c.id });
    const [ready] = await named(t.id, "take_ready");
    expect(await named(t.id, "take_ready")).toHaveLength(1);
    expect(ready?.props).toEqual({ aiEdit: "done", cuts: 2 });
    expect(await named(t.id, "ai_edit_used")).toHaveLength(1);
  });

  it("maps skipped ai_unavailable to unavailable and any other state or no row to none", async () => {
    const cases = [
      [{ status: "skipped", failureCode: "ai_unavailable" }, "unavailable"],
      [{ status: "skipped", failureCode: "no_speech" }, "none"],
      [{ status: "failed", failureCode: "internal_error" }, "none"],
      [null, "none"],
    ] as const;
    for (const [step, expected] of cases) {
      const { c, t, job } = await readyJob(step);
      await recordTakeReady(db, job, { id: t.id, creatorId: c.id });
      expect((await named(t.id, "take_ready"))[0]?.props).toMatchObject({ aiEdit: expected });
      expect(await named(t.id, "ai_edit_used")).toHaveLength(0);
    }
  });

  it("records nothing for a background change or a transcribe job", async () => {
    for (const kind of ["background", "transcribe"]) {
      const { c, t, job } = await readyJob({ status: "succeeded" }, kind);
      await recordTakeReady(db, job, { id: t.id, creatorId: c.id });
      expect(await named(t.id, "take_ready")).toHaveLength(0);
    }
  });

  it("records take_failed with the code every time, and refuses free text", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id);
    await recordTakeFailed(db, { id: t.id, creatorId: c.id }, "ffmpeg_error");
    await recordTakeFailed(db, { id: t.id, creatorId: c.id }, "ffmpeg_error");
    expect(await named(t.id, "take_failed")).toHaveLength(2);
    expect(await recordTakeFailed(db, { id: t.id, creatorId: c.id }, "my secret words")).toBe(
      false,
    );
    expect(await named(t.id, "take_failed")).toHaveLength(2);
  });

  it("refuses a once per take event with no take ID", async () => {
    const c = await createCreator(db);
    expect(
      await recordJobEvent(db, {
        name: "take_ready",
        creatorId: c.id,
        props: { aiEdit: "none", cuts: 0 },
      } as never),
    ).toBe(false);
  });

  it("never throws on a failed insert", async () => {
    const out = await recordJobEvent(db, { name: "signup", creatorId: "no-such-user" });
    expect(out).toBe(false);
  });
});
