import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, processingJob, render } from "../schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "../testing/test-db";
import type { Db } from "../types";
import { startChangeJob } from "./jobs";
import { built } from "./background-rerender-test-helpers";

/** Spec 0008, build step 3: a background change keeps the take Ready (AC-5, AC-6). */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(async () => {
  if (testDb) await built.clean(testDb.db);
  await testDb?.close();
});
async function seedBackground(over: Partial<typeof background.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(background)
    .values({
      id,
      creatorId: null,
      name: "Studio",
      imageKey: `backgrounds/builtin/${id}.jpg`,
      thumbKey: `backgrounds/builtin/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
      ...over,
    })
    .returning();
  return built.track(row!);
} /** A Ready take whose initial job succeeded with a latest render (keyed on `backgroundId`). */
async function readyTake(opts: { backgroundId?: string | null; keyed?: boolean } = {}) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, {
    status: "ready",
    durationMs: 10_000,
    backgroundId: opts.backgroundId ?? null,
  });
  const jobId = crypto.randomUUID();
  await db.insert(processingJob).values({
    id: jobId,
    takeId: t.id,
    kind: "initial",
    status: "succeeded",
    secondsCharged: 10,
    targetBackgroundId: opts.backgroundId ?? null,
  });
  const renderId = crypto.randomUUID();
  await db.insert(render).values({
    id: renderId,
    takeId: t.id,
    jobId,
    status: "succeeded",
    videoKey: `renders/${t.id}/${renderId}.mp4`,
    durationMs: 9_000,
    removedRanges: [],
    isLatest: true,
    backgroundId: opts.backgroundId ?? null,
    backgroundName: opts.backgroundId ? "Studio" : null,
    keyed: opts.keyed ?? false,
    keyColor: opts.keyed ? "#00b140" : null,
  });
  return { creator, take: t, renderId, initialJobId: jobId };
} /** A finished job started `startedAt`, on the take: a background change, or another kind. */
async function seedChange(
  takeId: string,
  startedAt: Date,
  kind: "background" | "rerender" = "background",
) {
  await db.insert(processingJob).values({
    id: crypto.randomUUID(),
    takeId,
    kind,
    status: "failed",
    failureCode: "internal_error",
    secondsCharged: 0,
    createdAt: startedAt,
  });
}
describe("background change limit (HRF-T01)", () => {
  it("allows 10 changes in an hour and refuses the 11th, then allows one after the window", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    for (let i = 0; i < 10; i += 1) await seedChange(t.id, new Date(now.getTime() - i * 60_000));
    const refused = await startChangeJob(db, {
      creatorId: creator.id,
      takeId: t.id,
      background: { id: bg.id },
      cuts: [],
      now,
    });
    expect(refused).toEqual({ ok: false, error: "background_change_limit" });
    // Nothing was started by the refusal.
    expect(
      (await db.select().from(processingJob).where(eq(processingJob.takeId, t.id))).filter(
        (j) => j.status === "queued",
      ),
    ).toHaveLength(0);
    // Once the oldest of the ten (made at `now`) is more than an hour old, the window has room.
    const later = new Date(now.getTime() + 3_600_000 + 1_000);
    const again = await startChangeJob(db, {
      creatorId: creator.id,
      takeId: t.id,
      background: { id: bg.id },
      cuts: [],
      now: later,
    });
    expect(again.ok).toBe(true);
  });

  it("counts the nine below the limit as allowed, whatever way the change went (failed ones included)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    for (let i = 0; i < 9; i += 1) await seedChange(t.id, now);
    expect(
      (
        await startChangeJob(db, {
          creatorId: creator.id,
          takeId: t.id,
          background: { id: bg.id },
          cuts: [],
          now,
        })
      ).ok,
    ).toBe(true);
  });

  it("counts the creator's changes across all their takes, not one take's", async () => {
    const bg = await seedBackground();
    const { creator, take: first } = await readyTake();
    const second = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
    const now = new Date();
    for (let i = 0; i < 6; i += 1) await seedChange(first.id, now);
    for (let i = 0; i < 4; i += 1) await seedChange(second.id, now);
    expect(
      await startChangeJob(db, {
        creatorId: creator.id,
        takeId: first.id,
        background: { id: bg.id },
        cuts: [],
        now,
      }),
    ).toEqual({ ok: false, error: "background_change_limit" });
  });

  it("one creator never blocks another, and other kinds do not count", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    // The same take's initial and transcribe jobs are not background changes.
    for (let i = 0; i < 10; i += 1) {
      await db.insert(processingJob).values({
        id: crypto.randomUUID(),
        takeId: t.id,
        kind: i % 2 === 0 ? "initial" : "transcribe",
        status: "succeeded",
        secondsCharged: 0,
        createdAt: now,
      });
    }
    expect(
      (
        await startChangeJob(db, {
          creatorId: creator.id,
          takeId: t.id,
          background: { id: bg.id },
          cuts: [],
          now,
        })
      ).ok,
    ).toBe(true);

    const busy = await readyTake();
    for (let i = 0; i < 10; i += 1) await seedChange(busy.take.id, now);
    const calm = await readyTake();
    expect(
      await startChangeJob(db, {
        creatorId: busy.creator.id,
        takeId: busy.take.id,
        background: { id: bg.id },
        cuts: [],
        now,
      }),
    ).toEqual({ ok: false, error: "background_change_limit" });
    expect(
      (
        await startChangeJob(db, {
          creatorId: calm.creator.id,
          takeId: calm.take.id,
          background: { id: bg.id },
          cuts: [],
          now,
        })
      ).ok,
    ).toBe(true);
  });

  it("a `rerender` (a re render of a failed take) does not count toward the limit", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const now = new Date();
    for (let i = 0; i < 10; i += 1) await seedChange(t.id, now, "rerender");
    expect(
      await startChangeJob(db, {
        creatorId: creator.id,
        takeId: t.id,
        background: { id: bg.id },
        cuts: [],
        now,
      }),
    ).toMatchObject({ ok: true });
  });
});
