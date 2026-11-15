import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import * as jobs from "../jobs";
import * as renders from "../renders";
import { attachUpload, getForCreator, listForCreator, rename } from ".";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
const SECRET = "test-usage-hash-secret-0123456789abcdef";
describe("takes.getForCreator, listForCreator and rename", () => {
  it("reads a take with its latest job and render", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const result = await getForCreator(db, creator.id, t.id);
    expect(result.ok && result.data).toMatchObject({
      take: { id: t.id },
      latestRender: null,
      latestJob: null,
    });
  });

  it("reads the latest job with its steps in order, and the latest render, after a run", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await jobs.start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET });
    if (!job.ok) throw new Error(job.error);
    const created = await renders.create(db, { takeId: t.id, jobId: job.data.id });
    if (!created.ok) throw new Error(created.error);
    await renders.completeLatest(db, { renderId: created.data.id, durationMs: 9_000 });
    await jobs.finish(db, { jobId: job.data.id, status: "succeeded" });

    const result = await getForCreator(db, creator.id, t.id);
    expect(result.ok && result.data.take.status).toBe("ready");
    expect(result.ok && result.data.latestRender?.id).toBe(created.data.id);
    expect(result.ok && result.data.latestJob?.id).toBe(job.data.id);
    expect(result.ok && result.data.latestJob?.steps.map((s) => s.name)).toEqual([
      "trim",
      "transcript",
      "ai_edit",
      "render",
    ]);
  });

  it("picks the newest job and the is_latest render among several", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const first = await jobs.start(db, {
      creatorId: creator.id,
      takeId: t.id,
      usageSecret: SECRET,
    });
    if (!first.ok) throw new Error(first.error);
    const firstRender = await renders.create(db, { takeId: t.id, jobId: first.data.id });
    if (!firstRender.ok) throw new Error(firstRender.error);
    await renders.completeLatest(db, { renderId: firstRender.data.id, durationMs: 9_000 });
    await jobs.finish(db, { jobId: first.data.id, status: "succeeded" });

    // A later re render that creates its own render, then fails.
    const second = await jobs.start(db, {
      creatorId: creator.id,
      takeId: t.id,
      usageSecret: SECRET,
    });
    if (!second.ok) throw new Error(second.error);
    const secondRender = await renders.create(db, { takeId: t.id, jobId: second.data.id });
    if (!secondRender.ok) throw new Error(secondRender.error);
    await jobs.finish(db, { jobId: second.data.id, status: "failed", failureCode: "ffmpeg_error" });

    const result = await getForCreator(db, creator.id, t.id);
    expect(result.ok && result.data.latestJob?.id).toBe(second.data.id);
    expect(result.ok && result.data.latestRender?.id).toBe(firstRender.data.id);
  });

  it("returns no latest render when the take only has a render that never became latest", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await jobs.start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET });
    if (!job.ok) throw new Error(job.error);
    const created = await renders.create(db, { takeId: t.id, jobId: job.data.id });
    if (!created.ok) throw new Error(created.error);
    await jobs.finish(db, { jobId: job.data.id, status: "failed", failureCode: "timeout" });

    const result = await getForCreator(db, creator.id, t.id);
    expect(result.ok && result.data.latestRender).toBeNull();
    expect(result.ok && result.data.latestJob?.id).toBe(job.data.id);
  });

  it("lists newest first across pages with no gaps or repeats", async () => {
    const creator = await createCreator(db);
    const base = Date.parse("2026-11-01T00:00:00Z");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      // Two takes share a timestamp to exercise the id tie break.
      const createdAt = new Date(base + Math.min(i, 3) * 1000);
      ids.push((await seedTake(db, creator.id, { title: `Take ${i}`, createdAt })).id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listForCreator(db, creator.id, { cursor, limit: 2 });
      if (!page.ok) throw new Error(page.error);
      expect(page.data.rows.length).toBeLessThanOrEqual(2);
      seen.push(...page.data.rows.map((row) => row.id));
      cursor = page.data.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    // Newest first: the two takes at +3s come first, ordered by id.
    const tied = [ids[3], ids[4]].sort();
    expect(seen.slice(0, 2)).toEqual(tied);
    expect(seen.slice(2)).toEqual([ids[2], ids[1], ids[0]]);
  });

  it("rejects a malformed cursor and caps the page size at 50", async () => {
    const creator = await createCreator(db);
    expect(await listForCreator(db, creator.id, { cursor: "nope" })).toEqual({
      ok: false,
      error: "invalid",
    });
    const result = await listForCreator(db, creator.id, { limit: 500 });
    expect(result.ok && result.data.rows).toEqual([]);
  });

  it("renames in any status, cleaning the title", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "expired" });
    const result = await rename(db, creator.id, t.id, "  New\tname ");
    expect(result.ok && result.data.title).toBe("New name");
    expect(await rename(db, creator.id, t.id, "   ")).toEqual({ ok: false, error: "invalid" });
    expect(await rename(db, creator.id, t.id, "x".repeat(201))).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});
describe("takes.getForCreator suggestion (spec 0012 AC-5)", () => {
  async function seedBackground(over: Partial<typeof background.$inferInsert> = {}) {
    const id = crypto.randomUUID();
    await db.insert(background).values({
      id,
      name: "Sunny loft",
      alt: "A loft",
      status: "ready",
      imageKey: "backgrounds/x/image.jpg",
      thumbKey: "backgrounds/x/thumb.webp",
      width: 1920,
      height: 1080,
      ...over,
    });
    return id;
  }
  const suggestion = async (creatorId: string, takeId: string) => {
    const result = await getForCreator(db, creatorId, takeId);
    if (!result.ok) throw new Error(result.error);
    return result.data.suggestion;
  };

  it("is null when there is none", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    expect(await suggestion(creator.id, t.id)).toBeNull();
  });

  it("names the suggested built in background and gives the reason", async () => {
    const creator = await createCreator(db);
    const id = await seedBackground();
    const t = await seedTake(db, creator.id, {
      suggestedBackgroundId: id,
      suggestionReason: "Warm light suits you",
    });
    expect(await suggestion(creator.id, t.id)).toEqual({
      backgroundId: id,
      name: "Sunny loft",
      reason: "Warm light suits you",
    });
  });

  it("is null for an upload (never a built in), and after the background is deleted", async () => {
    const creator = await createCreator(db);
    const upload = await seedBackground({ creatorId: creator.id });
    const t = await seedTake(db, creator.id, {
      suggestedBackgroundId: upload,
      suggestionReason: "Reason",
    });
    expect(await suggestion(creator.id, t.id)).toBeNull();

    const gone = await seedBackground();
    const t2 = await seedTake(db, creator.id, {
      suggestedBackgroundId: gone,
      suggestionReason: "Reason",
    });
    await db.delete(background).where(eq(background.id, gone));
    expect(await suggestion(creator.id, t2.id)).toBeNull();
  });
});
describe("ownership (AC-2)", () => {
  it("gives creator B not_found on creator A's take", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    const t = await seedTake(db, a.id);

    expect(await getForCreator(db, b.id, t.id)).toEqual({ ok: false, error: "not_found" });
    expect(await rename(db, b.id, t.id, "Mine now")).toEqual({ ok: false, error: "not_found" });
    const uploading = await seedTake(db, a.id, { status: "uploading" });
    expect(await attachUpload(db, b.id, uploading.id, "mpu-x")).toEqual({
      ok: false,
      error: "not_found",
    });
    const list = await listForCreator(db, b.id);
    expect(list.ok && list.data.rows).toEqual([]);

    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.title).toBe("Seeded take");
  });

  it("treats a malformed id as not_found", async () => {
    const a = await createCreator(db);
    expect(await getForCreator(db, a.id, "not-a-uuid")).toEqual({ ok: false, error: "not_found" });
  });
});
