import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, jobStep, processingJob, render, take, user } from "../schema";
import {
  type TestDb,
  createCreator,
  openTestDb,
  seedTake,
  builtInTracker,
} from "../testing/test-db";
import type { Db } from "../types";
import { pgErrorCode } from "../types";
import { create as createRender } from "./renders";
import { markRunning, startJob, whileJobActive } from "./jobs";

/** Spec 0008, build step 1: the job seam of a take with a background. */
const SECRET = "x".repeat(40);

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
const built = builtInTracker();
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
      name: "Test studio",
      imageKey: `backgrounds/builtin/${id}.jpg`,
      thumbKey: `backgrounds/builtin/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
      alt: "A test studio",
      ...over,
    })
    .returning();
  return built.track(row!);
}

async function takeWith(backgroundId: string | null) {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { durationMs: 10_000, backgroundId });
  return { creator, take: t };
}

const start = (creatorId: string, takeId: string) =>
  startJob(db, { creatorId, takeId, usageSecret: SECRET });

describe("startJob with a background (spec 0008)", () => {
  it("records the take's background on the job and creates the background step", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await takeWith(bg.id);
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    expect(started.data.targetBackgroundId).toBe(bg.id);
    expect(started.data.steps.map((s) => s.name)).toEqual([
      "trim",
      "transcript",
      "ai_edit",
      "background",
      "render",
    ]);
    // The charge does not depend on the background.
    expect(started.data.secondsCharged).toBe(10);
  });

  it("has no background step and no target for a take that keeps its original", async () => {
    const { creator, take: t } = await takeWith(null);
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    expect(started.data.targetBackgroundId).toBeNull();
    expect(started.data.steps.map((s) => s.name)).toEqual([
      "trim",
      "transcript",
      "ai_edit",
      "render",
    ]);
  });

  it("deleting a background keeps takes, jobs, renders and the creator's default", async () => {
    const bg = await seedBackground({ creatorId: null });
    const { creator, take: t } = await takeWith(bg.id);
    await db.update(user).set({ defaultBackgroundId: bg.id }).where(eq(user.id, creator.id));
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const made = await createRender(db, {
      takeId: t.id,
      jobId: started.data.id,
      background: {
        backgroundId: bg.id,
        backgroundName: bg.name,
        keyed: true,
        keyColor: "#00b140",
      },
    });
    if (!made.ok) throw new Error(made.error);

    await db.delete(background).where(eq(background.id, bg.id));

    const [takeRow] = await db.select().from(take).where(eq(take.id, t.id));
    const [jobRow] = await db
      .select()
      .from(processingJob)
      .where(eq(processingJob.id, started.data.id));
    const [renderRow] = await db.select().from(render).where(eq(render.id, made.data.id));
    const [userRow] = await db.select().from(user).where(eq(user.id, creator.id));
    expect(takeRow?.backgroundId).toBeNull();
    expect(jobRow?.targetBackgroundId).toBeNull();
    expect(userRow?.defaultBackgroundId).toBeNull();
    // The render keeps its name and its colour, so the take page can still say what it used.
    expect(renderRow).toMatchObject({
      backgroundId: null,
      backgroundName: "Test studio",
      keyed: true,
      keyColor: "#00b140",
    });
  });
});

describe("renders.create snapshot (spec 0008)", () => {
  it("records the background, whether the green was replaced and the key colour", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await takeWith(bg.id);
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    const keyed = await createRender(db, {
      takeId: t.id,
      jobId: started.data.id,
      background: {
        backgroundId: bg.id,
        backgroundName: bg.name,
        keyed: true,
        keyColor: "#00b140",
      },
    });
    expect(keyed.ok && keyed.data).toMatchObject({
      backgroundId: bg.id,
      backgroundName: "Test studio",
      keyed: true,
      keyColor: "#00b140",
    });
    // A skipped `no_green_screen` still names the background, but is not keyed.
    const skipped = await createRender(db, {
      takeId: t.id,
      jobId: started.data.id,
      background: { backgroundId: bg.id, backgroundName: bg.name, keyed: false, keyColor: null },
    });
    expect(skipped.ok && skipped.data).toMatchObject({ keyed: false, keyColor: null });
    // With no background the render is plain.
    const plain = await createRender(db, { takeId: t.id, jobId: started.data.id });
    expect(plain.ok && plain.data).toMatchObject({
      backgroundId: null,
      backgroundName: null,
      keyed: false,
      keyColor: null,
    });
  });
});

describe("renders.create when the background was deleted meanwhile (spec 0008)", () => {
  it("records no reference but keeps the name and the colour, instead of failing", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await takeWith(bg.id);
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    await db.delete(background).where(eq(background.id, bg.id));
    const made = await createRender(db, {
      takeId: t.id,
      jobId: started.data.id,
      background: {
        backgroundId: bg.id,
        backgroundName: bg.name,
        keyed: true,
        keyColor: "#00b140",
      },
    });
    expect(made.ok && made.data).toMatchObject({
      backgroundId: null,
      backgroundName: "Test studio",
      keyed: true,
      keyColor: "#00b140",
    });
  });
});

describe("background lock order (spec 0008)", () => {
  it("a background delete and a job start, or a guarded write, never deadlock", async () => {
    let deadlocks = 0;
    for (let i = 0; i < 20; i++) {
      const bg = await seedBackground();
      const { creator, take: t } = await takeWith(bg.id);
      const settled = await Promise.allSettled([
        db.delete(background).where(eq(background.id, bg.id)),
        start(creator.id, t.id),
      ]);
      for (const s of settled) {
        if (s.status === "rejected" && pgErrorCode(s.reason).code === "40P01") deadlocks += 1;
      }
    }
    expect(deadlocks).toBe(0);
  }, 60_000);

  it("a guarded write holds the job's background so a delete waits for it", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await takeWith(bg.id);
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const order: string[] = [];
    // The write signals when it holds its locks; the delete starts only then, and the write
    // finishes only after the delete has been issued (no sleeps, so a slow database can't
    // reorder the two).
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const hasEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const mayFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = whileJobActive(db, started.data.id, async () => {
      order.push("write started");
      entered();
      await mayFinish;
      order.push("write done");
      return { ok: true as const, data: 1 };
    });
    await hasEntered;
    const del = db
      .delete(background)
      .where(eq(background.id, bg.id))
      .then(() => order.push("deleted"));
    // Give the delete time to reach Postgres and block on the background lock, then let the
    // write finish; the delete can only complete after it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(order).toEqual(["write started"]);
    release();
    await Promise.all([write, del]);
    expect(order).toEqual(["write started", "write done", "deleted"]);
  });
});

describe("the background step", () => {
  it("accepts the no_green_screen skip reason and no other on a skipped step", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await takeWith(bg.id);
    const started = await start(creator.id, t.id);
    if (!started.ok) throw new Error(started.error);
    const { updateStep } = await import("./jobs");
    await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
    const ok = await updateStep(db, {
      jobId: started.data.id,
      name: "background",
      status: "skipped",
      progress: 0,
      failureCode: "no_green_screen",
    });
    expect(ok.ok).toBe(true);
    const [step] = await db.select().from(jobStep).where(eq(jobStep.jobId, started.data.id));
    expect(step).toBeDefined();
    const bad = await updateStep(db, {
      jobId: started.data.id,
      name: "background",
      status: "skipped",
      progress: 0,
      failureCode: "ffmpeg_error",
    });
    expect(bad.ok).toBe(false);
  });
});
