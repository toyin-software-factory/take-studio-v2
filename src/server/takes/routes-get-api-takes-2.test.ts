import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish } from "@/db/data/jobs";
import { analyticsEvent, jobStep, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { MEDIA_LINKS } from "@/lib/uploads";
import { type MediaHttpDeps, handleMedia } from "../media";
import { start } from "../jobs";
import { NOT_FOUND, ORIGIN, SECRET, req, type Signed } from "./routes-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_routes_get_api_takes_2" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
function mediaDeps(creatorId: string | null, stored: Set<string> | "all" = "all") {
  const signed: Signed[] = [];
  const deps: MediaHttpDeps = {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    headObject: async (key) => (stored === "all" || stored.has(key) ? { size: 1 } : null),
    presignGet: async (key, { expiresSeconds, disposition }) => {
      signed.push({ key, expiresSeconds, ...disposition });
      return `https://r2.test/${key}?X-Amz-Expires=${expiresSeconds}`;
    },
  };
  return { deps, signed };
} /** A ready take with a succeeded job (trim and render steps set) and optionally a render. */
async function readyTake(
  creatorId: string,
  options: {
    title?: string;
    trim?: "succeeded" | "skipped";
    render?: "succeeded";
    ranges?: { startMs: number; endMs: number }[];
  } = {},
) {
  const id = crypto.randomUUID();
  const t = await seedTake(db, creatorId, {
    id,
    status: "uploaded",
    title: options.title ?? "Seeded take",
    container: "mov",
    originalKey: `originals/${id}/source.mov`,
  });
  const job = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  const jobId = job.data.id;
  if (options.render === "succeeded") {
    const renderId = crypto.randomUUID();
    await db.insert(render).values({
      id: renderId,
      takeId: t.id,
      jobId,
      status: "succeeded",
      videoKey: `renders/${t.id}/${renderId}.mp4`,
      durationMs: 50_000,
      removedRanges: options.ranges ?? [],
    });
  }
  // Only this job's steps.
  await db
    .update(jobStep)
    .set({ status: options.trim ?? "succeeded" })
    .where(and(eq(jobStep.jobId, jobId), eq(jobStep.name, "trim")));
  await db
    .update(jobStep)
    .set({ status: options.render === "succeeded" ? "succeeded" : "skipped" })
    .where(and(eq(jobStep.jobId, jobId), eq(jobStep.name, "render")));
  const done = await finish(db, { jobId, status: "succeeded" });
  if (!done.ok) throw new Error(done.error);
  return t;
}
describe("GET /api/takes/{id}/media (AC-9, AC-12)", () => {
  it("plays inline for 1 hour and downloads as a 15 minute attachment named from the title", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, { title: "Café crème — take 2!", render: "succeeded" });
    const { deps, signed } = mediaDeps(creator.id);
    for (const kind of ["play", "download", "original"]) {
      const res = await handleMedia(req("GET", `/x?kind=${kind}`), t.id, deps);
      expect(res.status).toBe(200);
      expect((await res.json()).url).toMatch(/^https:\/\/r2\.test\//);
    }
    expect(signed).toEqual([
      expect.objectContaining({
        expiresSeconds: MEDIA_LINKS.playSeconds,
        type: "inline",
        fileName: "cafe-creme-take-2-trimmed.mp4",
      }),
      expect.objectContaining({
        expiresSeconds: MEDIA_LINKS.downloadSeconds,
        type: "attachment",
        fileName: "cafe-creme-take-2-trimmed.mp4",
      }),
      expect.objectContaining({
        expiresSeconds: MEDIA_LINKS.downloadSeconds,
        type: "attachment",
        fileName: "cafe-creme-take-2-original.mov",
        key: t.originalKey,
      }),
    ]);
    expect(signed[0]?.key).toMatch(/^renders\//);
  });

  it("records take_downloaded for a download link only, every time (spec 0016 AC-5)", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, { render: "succeeded" });
    const { deps } = mediaDeps(creator.id);
    for (const kind of ["play", "thumb", "original", "download", "download"]) {
      await handleMedia(req("GET", `/x?kind=${kind}`), t.id, deps);
    }
    const rows = await db
      .select()
      .from(analyticsEvent)
      .where(
        and(
          eq(analyticsEvent.creatorId, creator.id),
          eq(analyticsEvent.takeId, t.id),
          eq(analyticsEvent.name, "take_downloaded"),
        ),
      );
    expect(rows.map((r) => [r.name, r.props])).toEqual([
      ["take_downloaded", { kind: "video" }],
      ["take_downloaded", { kind: "video" }],
    ]);
    const reviewed = await db
      .select()
      .from(analyticsEvent)
      .where(and(eq(analyticsEvent.takeId, t.id), eq(analyticsEvent.name, "cuts_reviewed")));
    expect(reviewed).toHaveLength(2);
  });

  it("downloads the original when a ready take has no render (AC-7), named take-… for a non ASCII title", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, { title: "日本語のテイク" });
    const { deps, signed } = mediaDeps(creator.id);
    expect((await handleMedia(req("GET", "/x?kind=download"), t.id, deps)).status).toBe(200);
    expect(signed[0]).toMatchObject({ key: t.originalKey, fileName: "take-original.mov" });
  });

  it("is 404 with no file and 410 once expired", async () => {
    const creator = await createCreator(db);
    const processing = await seedTake(db, creator.id, { status: "processing" });
    expect(
      (await handleMedia(req("GET", "/x?kind=download"), processing.id, mediaDeps(creator.id).deps))
        .status,
    ).toBe(404);

    const ready = await readyTake(creator.id, { render: "succeeded" });
    const missing = await handleMedia(
      req("GET", "/x?kind=original"),
      ready.id,
      mediaDeps(creator.id, new Set()).deps,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(NOT_FOUND);

    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, ready.id));
    const gone = await handleMedia(
      req("GET", "/x?kind=play"),
      ready.id,
      mediaDeps(creator.id).deps,
    );
    expect(gone.status).toBe(410);
    expect((await gone.json()).error).toBe("expired");
  });

  it("serves the thumbnail inline for 1 hour, 404 when missing, and only to the owner", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const t = await readyTake(creator.id, { render: "succeeded" });
    const { deps, signed } = mediaDeps(creator.id);
    const res = await handleMedia(req("GET", "/x?kind=thumb"), t.id, deps);
    expect(res.status).toBe(200);
    expect(signed).toEqual([
      {
        key: `originals/${t.id}/thumb.jpg`,
        expiresSeconds: 3600,
        type: "inline",
        fileName: "thumbnail.jpg",
      },
    ]);

    const missing = await handleMedia(
      req("GET", "/x?kind=thumb"),
      t.id,
      mediaDeps(creator.id, new Set()).deps,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(NOT_FOUND);

    const foreign = await handleMedia(req("GET", "/x?kind=thumb"), t.id, mediaDeps(other.id).deps);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(NOT_FOUND);
  });

  it("treats an unknown kind like a missing file", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, { render: "succeeded" });
    const res = await handleMedia(
      req("GET", "/x?kind=thumbnail"),
      t.id,
      mediaDeps(creator.id).deps,
    );
    expect(res.status).toBe(404);
  });
});
