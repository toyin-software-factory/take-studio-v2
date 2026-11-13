import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import * as jobs from "../jobs";
import * as renders from "../renders";
import {
  attachUpload,
  create,
  getForCreator,
  listForCreator,
  markUploaded,
  rename,
  transition,
} from ".";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const SECRET = "test-usage-hash-secret-0123456789abcdef";
const probe = { durationMs: 61_500, width: 1920, height: 1080, container: "mp4" };

describe("takes.create", () => {
  it("creates an uploading take with an app generated id and original key", async () => {
    const creator = await createCreator(db);
    const result = await create(db, {
      creatorId: creator.id,
      fileName: " Morning take.MP4 ",
      container: "mp4",
      bytes: 5_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      creatorId: creator.id,
      title: "Morning take",
      status: "uploading",
      originalKey: `originals/${result.data.id}/source.mp4`,
      originalBytes: 5_000_000,
    });
  });

  it("rejects bad input with invalid", async () => {
    const creator = await createCreator(db);
    const base = { creatorId: creator.id, fileName: "a.mp4", container: "mp4" as const, bytes: 1 };
    expect(await create(db, { ...base, fileName: "  .mp4 " })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await create(db, { ...base, bytes: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(await create(db, { ...base, bytes: 3 * 1024 ** 3 })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await create(db, { ...base, container: "webm" as "mp4" })).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});

describe("takes.attachUpload", () => {
  it("stores the multipart upload id only while the take is uploading", async () => {
    const creator = await createCreator(db);
    const created = await create(db, {
      creatorId: creator.id,
      fileName: "a.mov",
      container: "mov",
      bytes: 10,
    });
    if (!created.ok) throw new Error(created.error);
    expect(created.data.uploadId).toBeNull();

    const attached = await attachUpload(db, creator.id, created.data.id, "mpu-123");
    expect(attached.ok && attached.data.uploadId).toBe("mpu-123");
    expect(await attachUpload(db, creator.id, created.data.id, "  ")).toEqual({
      ok: false,
      error: "invalid",
    });

    const uploaded = await seedTake(db, creator.id, { status: "uploaded" });
    expect(await attachUpload(db, creator.id, uploaded.id, "mpu-9")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });
});

describe("takes.markUploaded (AC-5)", () => {
  it("marks a take uploaded with its probe and a 30 day expiry, once", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, {
      status: "uploading",
      durationMs: null,
      width: null,
      height: null,
      videoExpiresAt: null,
      uploadId: "mpu-1",
    });
    const now = new Date("2026-11-11T10:00:00Z");
    const result = await markUploaded(db, { takeId: t.id, sizeBytes: 4_000_000, probe, now });
    expect(result.ok && result.data).toMatchObject({
      status: "uploaded",
      durationMs: 61_500,
      width: 1920,
      height: 1080,
      originalBytes: 4_000_000,
      uploadId: null,
      videoExpiresAt: new Date("2026-12-11T10:00:00Z"),
    });
    // A repeat is not a valid transition.
    expect(await markUploaded(db, { takeId: t.id, sizeBytes: 1, probe })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("fails a take outside the limits with a non refundable code", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "uploading", durationMs: null });
    const result = await markUploaded(db, {
      takeId: t.id,
      sizeBytes: 1_000,
      probe: { ...probe, durationMs: 11 * 60 * 1000 },
    });
    expect(result.ok && result.data).toMatchObject({
      status: "failed",
      failureCode: "too_long",
      // The probe's facts are kept so the page can say "This video is 11 minutes long".
      durationMs: 11 * 60 * 1000,
      width: 1920,
      height: 1080,
    });
  });

  it("returns not_found for a missing take", async () => {
    expect(await markUploaded(db, { takeId: crypto.randomUUID(), sizeBytes: 1, probe })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("takes.transition (AC-3)", () => {
  it("applies an allowed transition as a compare and swap", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "uploaded" });
    const moved = await transition(db, { takeId: t.id, from: "uploaded", to: "processing" });
    expect(moved.ok && moved.data.status).toBe("processing");
    // The take is no longer `uploaded`, so the same swap now fails.
    expect(await transition(db, { takeId: t.id, from: "uploaded", to: "processing" })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("rejects transitions the state machine does not allow, without touching the row", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "uploaded" });
    for (const [from, to] of [
      ["uploaded", "ready"],
      ["uploaded", "uploading"],
      ["expired", "processing"],
    ] as const) {
      expect(await transition(db, { takeId: t.id, from, to })).toEqual({
        ok: false,
        error: "invalid_transition",
      });
    }
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.status).toBe("uploaded");
  });
});

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
