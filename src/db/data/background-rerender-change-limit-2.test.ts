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
  testDb = await openTestDb({ database: "take_studio_test_background_rerender_change_limit_2" });
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
  it("parallel requests cannot both pass the last free slot (the creator's row is locked)", async () => {
    const bg = await seedBackground();
    const { creator } = await readyTake();
    const takes = await Promise.all(
      [0, 1].map(() => seedTake(db, creator.id, { status: "ready", durationMs: 10_000 })),
    );
    const now = new Date();
    const filler = takes[0]!;
    for (let i = 0; i < 9; i += 1) await seedChange(filler.id, now);
    const results = await Promise.all(
      takes.map((t) =>
        startChangeJob(db, {
          creatorId: creator.id,
          takeId: t.id,
          background: { id: bg.id },
          cuts: [],
          now,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "background_change_limit")).toHaveLength(1);
  });
});
