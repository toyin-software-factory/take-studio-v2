import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { analyticsEvent, cut, jobStep, processingJob, take, user } from "@/db/schema";
import type { JobStatus } from "@/lib/processing";
import { createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import { purgeOldAnalyticsEvents, repairAnalyticsEvents } from "./analytics-repair";

// Its own database: the repair looks at every user and take, so it must not share one.
const test = await openTestDb({ database: "take_studio_test_analytics_repair" });
const { db } = test;
afterAll(async () => {
  await test.close();
});

const DAY = 24 * 60 * 60 * 1000;
const events = (takeId: string) =>
  db.select().from(analyticsEvent).where(eq(analyticsEvent.takeId, takeId));
const repairAll = async () => {
  for (let i = 0; i < 20; i++) {
    const added = await repairAnalyticsEvents(db, 50);
    if (Object.values(added).every((n) => n === 0)) return;
  }
};

async function job(takeId: string, kind: string, status: JobStatus, finishedAt: Date) {
  const id = crypto.randomUUID();
  await db
    .insert(processingJob)
    .values({ id, takeId, kind, status, secondsCharged: 1, finishedAt });
  return id;
}
const step = (jobId: string, status: string, finishedAt: Date, failureCode?: string) =>
  db.insert(jobStep).values({
    id: crypto.randomUUID(),
    jobId,
    name: "ai_edit",
    position: 1,
    status,
    finishedAt,
    failureCode: failureCode ?? null,
  });
const aiCut = (takeId: string, i: number) =>
  db.insert(cut).values({
    id: crypto.randomUUID(),
    takeId,
    startMs: i * 1000,
    endMs: i * 1000 + 500,
    kind: "filler",
    proposedBy: "ai",
  });

describe("repair and backfill (spec 0016, AC-6, AC-12)", () => {
  it("inserts a missing signup at the user's own time, and only once", async () => {
    const c = await createCreator(db);
    const created = new Date(Date.now() - 40 * DAY);
    await db.update(user).set({ createdAt: created }).where(eq(user.id, c.id));
    await repairAll();
    await repairAll();
    const rows = await db
      .select()
      .from(analyticsEvent)
      .where(and(eq(analyticsEvent.creatorId, c.id), eq(analyticsEvent.name, "signup")));
    expect(rows).toHaveLength(1);
    expect(Math.abs(rows[0]!.occurredAt.getTime() - created.getTime())).toBeLessThan(1000);
  });

  it("inserts take_uploaded at the probe time derived from video_expires_at", async () => {
    const c = await createCreator(db);
    const uploadedAt = new Date(Date.now() - 10 * DAY);
    const t = await seedTake(db, c.id, {
      videoExpiresAt: new Date(uploadedAt.getTime() + 30 * DAY),
    });
    const unprobed = await seedTake(db, c.id, { status: "uploading", videoExpiresAt: null });
    await repairAll();
    const rows = await events(t.id);
    expect(rows.map((r) => r.name)).toEqual(["take_uploaded"]);
    expect(Math.abs(rows[0]!.occurredAt.getTime() - uploadedAt.getTime())).toBeLessThan(1000);
    expect(await events(unprobed.id)).toHaveLength(0);
  });

  it("inserts take_ready and ai_edit_used from the first succeeded video job, at its times", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id, { status: "ready" });
    await aiCut(t.id, 0);
    await aiCut(t.id, 1);
    const first = new Date(Date.now() - 5 * DAY);
    const j1 = await job(t.id, "initial", "succeeded", first);
    await step(j1, "succeeded", new Date(first.getTime() - 1000));
    await job(t.id, "rerender", "succeeded", new Date(Date.now() - DAY));
    // Not video jobs, and a failed one: none of them counts.
    await job(t.id, "background", "succeeded", new Date(Date.now() - 6 * DAY));
    await job(t.id, "transcribe", "succeeded", new Date(Date.now() - 7 * DAY));
    await repairAll();
    const byName = Object.fromEntries((await events(t.id)).map((r) => [r.name, r]));
    expect(byName.take_ready?.props).toEqual({ aiEdit: "done", cuts: 2 });
    expect(Math.abs(byName.take_ready!.occurredAt.getTime() - first.getTime())).toBeLessThan(1000);
    expect(byName.ai_edit_used?.props).toEqual({ cuts: 2 });
    expect(byName.ai_edit_used!.occurredAt.getTime()).toBe(first.getTime() - 1000);
  });

  it("maps a skipped ai_unavailable step to unavailable and no step to none, with no ai_edit_used", async () => {
    const c = await createCreator(db);
    const a = await seedTake(db, c.id, { status: "ready" });
    const b = await seedTake(db, c.id, { status: "ready" });
    const ja = await job(a.id, "initial", "succeeded", new Date());
    await step(ja, "skipped", new Date(), "ai_unavailable");
    await job(b.id, "initial", "succeeded", new Date());
    await repairAll();
    const ready = (id: string) => events(id).then((r) => r.find((e) => e.name === "take_ready"));
    expect((await ready(a.id))?.props).toEqual({ aiEdit: "unavailable", cuts: 0 });
    expect((await ready(b.id))?.props).toEqual({ aiEdit: "none", cuts: 0 });
    expect((await events(a.id)).some((e) => e.name === "ai_edit_used")).toBe(false);
  });

  it("does not repair ai_edit_used from a succeeded ai_edit step on a failed or running job", async () => {
    const c = await createCreator(db);
    const failed = await seedTake(db, c.id, { status: "failed" });
    const running = await seedTake(db, c.id, { status: "processing" });
    await step(await job(failed.id, "initial", "failed", new Date()), "succeeded", new Date());
    await step(await job(running.id, "initial", "running", new Date()), "succeeded", new Date());
    await repairAll();
    expect((await events(failed.id)).some((e) => e.name === "ai_edit_used")).toBe(false);
    expect((await events(running.id)).some((e) => e.name === "ai_edit_used")).toBe(false);
  });

  it("is idempotent, keeps a live event as it is, and does not recover a deleted take", async () => {
    const c = await createCreator(db);
    const live = await seedTake(db, c.id, { status: "ready" });
    await db.insert(analyticsEvent).values({
      name: "take_ready",
      creatorId: c.id,
      takeId: live.id,
      props: { aiEdit: "none", cuts: 0 },
    });
    await job(live.id, "initial", "succeeded", new Date());
    const gone = await seedTake(db, c.id);
    await db.delete(take).where(eq(take.id, gone.id));
    const before = await db.select().from(analyticsEvent).where(eq(analyticsEvent.creatorId, c.id));
    await repairAll();
    await repairAll();
    const after = await db.select().from(analyticsEvent).where(eq(analyticsEvent.creatorId, c.id));
    const liveReady = after.filter((e) => e.takeId === live.id && e.name === "take_ready");
    expect(liveReady).toHaveLength(1);
    expect(liveReady[0]!.id).toBe(before.find((e) => e.name === "take_ready")!.id);
    // The signup and the live take's upload are the only additions; nothing for the gone take.
    expect(after.filter((e) => e.name !== "signup").every((e) => e.takeId !== null)).toBe(true);
    expect(after.filter((e) => e.name === "take_uploaded")).toHaveLength(1);
  });

  it("repairs in batches until nothing is missing", async () => {
    const c = await createCreator(db);
    for (let i = 0; i < 3; i++) await seedTake(db, c.id);
    const first = await repairAnalyticsEvents(db, 1);
    expect(first.signup).toBeLessThanOrEqual(1);
    expect(first.take_uploaded).toBeLessThanOrEqual(1);
    await repairAll();
    const rows = await db
      .select()
      .from(analyticsEvent)
      .where(and(eq(analyticsEvent.creatorId, c.id), eq(analyticsEvent.name, "take_uploaded")));
    expect(rows).toHaveLength(3);
  });
});

describe("retention purge (spec 0016, AC-9)", () => {
  it("deletes repeatable events past 13 months and keeps newer ones and every milestone", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id);
    const now = new Date();
    const old = new Date(now.getTime() - 14 * 30 * DAY);
    const recent = new Date(now.getTime() - 12 * 30 * DAY);
    const row = (name: string, occurredAt: Date, takeId: string | null = null, props = {}) => ({
      name,
      creatorId: c.id,
      takeId,
      props,
      occurredAt,
    });
    await db
      .insert(analyticsEvent)
      .values([
        row("take_downloaded", old, null, { kind: "video" }),
        row("limit_hit", old, null, { place: "upload_start" }),
        row("change_requested", recent),
        row("signup", old),
        row("take_uploaded", old, t.id),
      ]);
    let removed = 0;
    for (let i = 0; i < 5; i++) removed += await purgeOldAnalyticsEvents(db, now, 1);
    expect(removed).toBeGreaterThanOrEqual(2);
    const left = await db
      .select({ name: analyticsEvent.name })
      .from(analyticsEvent)
      .where(
        and(
          eq(analyticsEvent.creatorId, c.id),
          inArray(analyticsEvent.name, [
            "take_downloaded",
            "limit_hit",
            "change_requested",
            "signup",
            "take_uploaded",
          ]),
        ),
      );
    expect(left.map((r) => r.name).sort()).toEqual(["change_requested", "signup", "take_uploaded"]);
  });
});
