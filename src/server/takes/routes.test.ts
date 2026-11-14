import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish } from "@/db/data/jobs";
import {
  analyticsEvent,
  cut,
  jobStep,
  processingJob,
  render,
  storageDeletion,
  take,
} from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { MEDIA_LINKS } from "@/lib/uploads";
import { type MediaHttpDeps, handleMedia } from "../media";
import { start } from "../jobs";
import {
  type TakeHttpDeps,
  handleDelete,
  handleGet,
  handleList,
  handleRename,
  handleRetry,
} from "./http";

const ORIGIN = "https://take-studio.example";
const SECRET = "x".repeat(40);
const NOT_FOUND = { error: "not_found", message: "We couldn't find that take." };

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

function takeDeps(
  creatorId: string | null,
  triggered: string[] = [],
  failTrigger = false,
): TakeHttpDeps {
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    usageSecret: () => SECRET,
    triggerProcessTake: async (jobId) => {
      if (failTrigger) throw new Error("trigger down");
      triggered.push(jobId);
      return { id: `run_${jobId}` };
    },
  };
}

type Signed = { key: string; expiresSeconds: number; type: string; fileName: string };

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
}

function req(
  method: string,
  path: string,
  body?: unknown,
  origin: string | null = ORIGIN,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A take that failed with `code` through the real job path (charged, then refunded if refundable). */
async function failedTake(
  creatorId: string,
  code: "internal_error" | "too_long" | "cancelled_while_running",
) {
  const t = await seedTake(db, creatorId, { status: "uploaded" });
  const job = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  const done = await finish(db, {
    jobId: job.data.id,
    status: code === "cancelled_while_running" ? "cancelled" : "failed",
    failureCode: code,
  });
  if (!done.ok) throw new Error(done.error);
  return t;
}

/** A ready take with a succeeded job (trim and render steps set) and optionally a render. */
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

describe("session and Origin (spec 0004 API surface)", () => {
  it("answers 401 on every route when signed out", async () => {
    const id = crypto.randomUUID();
    for (const res of [
      await handleList(req("GET", "/api/takes"), takeDeps(null)),
      await handleGet(req("GET", `/api/takes/${id}`), id, takeDeps(null)),
      await handleRename(req("PATCH", `/api/takes/${id}`, { title: "x" }), id, takeDeps(null)),
      await handleRetry(req("POST", `/api/takes/${id}/retry`), id, takeDeps(null)),
      await handleDelete(req("DELETE", `/api/takes/${id}`), id, takeDeps(null)),
      await handleMedia(req("GET", `/api/takes/${id}/media?kind=play`), id, mediaDeps(null).deps),
    ]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("checks Origin on PATCH and POST only", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const deps = takeDeps(creator.id);
    expect(
      (await handleRename(req("PATCH", "/x", { title: "y" }, "https://evil.example"), t.id, deps))
        .status,
    ).toBe(403);
    expect((await handleRetry(req("POST", "/x", undefined, null), t.id, deps)).status).toBe(403);
    expect((await handleGet(req("GET", "/x", undefined, null), t.id, deps)).status).toBe(200);
    expect((await handleList(req("GET", "/api/takes", undefined, null), deps)).status).toBe(200);
  });
});

describe("ownership (AC-11)", () => {
  it("gives another creator and a malformed ID the same 404 on every route, and changes nothing", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await failedTake(owner.id, "internal_error");
    for (const id of [t.id, "not-a-uuid", crypto.randomUUID()]) {
      const responses = [
        await handleGet(req("GET", "/x"), id, takeDeps(other.id)),
        await handleRename(req("PATCH", "/x", { title: "Hijacked" }), id, takeDeps(other.id)),
        await handleRetry(req("POST", "/x"), id, takeDeps(other.id)),
        await handleDelete(req("DELETE", "/x"), id, takeDeps(other.id)),
        ...(await Promise.all(
          (["play", "download", "original"] as const).map((kind) =>
            handleMedia(req("GET", `/x?kind=${kind}`), id, mediaDeps(other.id).deps),
          ),
        )),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(NOT_FOUND);
      }
    }
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.title).toBe("Seeded take");
    expect(row?.status).toBe("failed");
  });

  it("lists only the creator's own takes", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    await seedTake(db, a.id, { title: "A's take" });
    await seedTake(db, b.id, { title: "B's take" });
    const res = await handleList(req("GET", "/api/takes"), takeDeps(a.id));
    const body = (await res.json()) as { takes: { title: string }[] };
    expect(body.takes.map((card) => card.title)).toEqual(["A's take"]);
  });
});

describe("GET /api/takes (AC-1)", () => {
  it("pages 24 at a time, newest first, with a cursor", async () => {
    const creator = await createCreator(db);
    for (let i = 0; i < 30; i += 1) {
      await seedTake(db, creator.id, {
        title: `Take ${i}`,
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
      });
    }
    const first = (await (
      await handleList(req("GET", "/api/takes"), takeDeps(creator.id))
    ).json()) as {
      takes: { title: string }[];
      nextCursor: string | null;
    };
    expect(first.takes).toHaveLength(24);
    expect(first.takes[0]?.title).toBe("Take 29");
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await handleList(
        req("GET", `/api/takes?cursor=${encodeURIComponent(first.nextCursor!)}`),
        takeDeps(creator.id),
      )
    ).json()) as { takes: { title: string }[]; nextCursor: string | null };
    expect(second.takes.map((t) => t.title)).toEqual([
      "Take 5",
      "Take 4",
      "Take 3",
      "Take 2",
      "Take 1",
      "Take 0",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor with 400", async () => {
    const creator = await createCreator(db);
    const res = await handleList(req("GET", "/api/takes?cursor=%%%"), takeDeps(creator.id));
    expect(res.status).toBe(400);
  });

  it("gives failed cards their code and whether they can be retried (AC-10)", async () => {
    const creator = await createCreator(db);
    await failedTake(creator.id, "internal_error");
    await failedTake(creator.id, "too_long");
    const body = (await (
      await handleList(req("GET", "/api/takes"), takeDeps(creator.id))
    ).json()) as {
      takes: { failureCode: string; retryable: boolean }[];
    };
    expect(body.takes.map((c) => [c.failureCode, c.retryable])).toEqual([
      ["too_long", false],
      ["internal_error", true],
    ]);
  });
});

describe("GET /api/takes/{id} (AC-7, AC-8, AC-9)", () => {
  it("returns the take, job with steps, render and removedMs from the render, without storage keys", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, {
      render: "succeeded",
      ranges: [
        { startMs: 1000, endMs: 2400 },
        { startMs: 9000, endMs: 9750 },
      ],
    });
    const res = await handleGet(req("GET", "/x"), t.id, takeDeps(creator.id));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.take).toMatchObject({
      id: t.id,
      status: "ready",
      retryable: false,
      expired: false,
    });
    expect(body.latestJob.steps.map((s: { name: string }) => s.name)).toEqual([
      "trim",
      "transcript",
      "ai_edit",
      "render",
    ]);
    expect(body.latestRender).toMatchObject({ status: "succeeded", durationMs: 50_000 });
    expect(body.removedMs).toBe(2150);
    expect(body.note).toBeNull();
    expect(text).not.toMatch(/originals\/|renders\//);
  });

  it("sums applied cuts when there is no render yet", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "processing" });
    await db.insert(cut).values([
      {
        id: crypto.randomUUID(),
        takeId: t.id,
        startMs: 0,
        endMs: 500,
        kind: "pause",
        proposedBy: "rules",
        applied: true,
      },
      {
        id: crypto.randomUUID(),
        takeId: t.id,
        startMs: 2000,
        endMs: 4000,
        kind: "pause",
        proposedBy: "rules",
        applied: false,
      },
    ]);
    const body = await (await handleGet(req("GET", "/x"), t.id, takeDeps(creator.id))).json();
    expect(body.removedMs).toBe(500);
  });

  it("notes no cuts and no audio (AC-7)", async () => {
    const creator = await createCreator(db);
    const noCuts = await readyTake(creator.id);
    const noAudio = await readyTake(creator.id, { trim: "skipped" });
    expect(
      (await (await handleGet(req("GET", "/x"), noCuts.id, takeDeps(creator.id))).json()).note,
    ).toBe("no_cuts");
    expect(
      (await (await handleGet(req("GET", "/x"), noAudio.id, takeDeps(creator.id))).json()).note,
    ).toBe("no_audio");
  });
});

describe("PATCH /api/takes/{id}", () => {
  it("renames, and rejects an empty or missing title with 422", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const ok = await handleRename(
      req("PATCH", "/x", { title: "  Studio intro  " }),
      t.id,
      takeDeps(creator.id),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).take.title).toBe("Studio intro");
    expect(
      (await handleRename(req("PATCH", "/x", { title: "   " }), t.id, takeDeps(creator.id))).status,
    ).toBe(422);
    expect((await handleRename(req("PATCH", "/x", {}), t.id, takeDeps(creator.id))).status).toBe(
      422,
    );
  });
});

describe("POST /api/takes/{id}/retry (AC-10, spec 0002)", () => {
  it("starts and dispatches a new run after a non media failure, without a second live charge", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    const triggered: string[] = [];
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, triggered));
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string } };
    expect(triggered).toEqual([job.id]);

    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    expect(jobs).toHaveLength(2);
    // The failed run was refunded, so at most one charge is live at any time.
    const live = jobs.filter((j) => j.secondsCharged > 0 && !j.refunded);
    expect(live.length).toBeLessThanOrEqual(1);
    expect(jobs.find((j) => j.status === "failed")?.refunded).toBe(true);
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.status).toBe("processing");
  });

  it("retries a take that was cancelled while running (not a media failure)", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "cancelled_while_running");
    const [before] = await db.select().from(take).where(eq(take.id, t.id));
    expect(before).toMatchObject({ status: "failed", failureCode: "cancelled_while_running" });
    const triggered: string[] = [];
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, triggered));
    expect(res.status).toBe(202);
    expect(triggered).toHaveLength(1);
  });

  it("refuses a failed take that was never probed (409)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, {
      status: "failed",
      failureCode: "internal_error",
      durationMs: null,
    });
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_retryable");
  });

  it("answers a friendly 503, not a 500, when USAGE_HASH_SECRET is missing, and starts nothing", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    const deps: TakeHttpDeps = {
      ...takeDeps(creator.id),
      usageSecret: () => {
        throw new Error("Invalid usage env: USAGE_HASH_SECRET");
      },
    };
    const res = await handleRetry(req("POST", "/x"), t.id, deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "unavailable",
      message: "Processing isn't available right now. Please try again later.",
    });
    const jobs = await db.select().from(processingJob).where(eq(processingJob.takeId, t.id));
    expect(jobs).toHaveLength(1);
  });

  it("refuses a retry once the video has expired, even before the sweep runs (CodeRabbit #35)", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, t.id));
    const triggered: string[] = [];
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, triggered));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_retryable");
    expect(triggered).toEqual([]);

    const card = await handleGet(req("GET", "/x"), t.id, takeDeps(creator.id));
    const body = (await card.json()) as { take: { retryable: boolean; expired: boolean } };
    expect(body.take).toMatchObject({ expired: true, retryable: false });
  });

  it("refuses media failures with 409, so the page offers 'Upload another video'", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "too_long");
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_retryable");
  });

  it("refuses while a run is in progress (409)", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    const again = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("job_in_progress");
  });

  it("reports 503 when dispatch fails, leaving the take retryable again", async () => {
    const creator = await createCreator(db);
    const t = await failedTake(creator.id, "internal_error");
    const res = await handleRetry(req("POST", "/x"), t.id, takeDeps(creator.id, [], true));
    expect(res.status).toBe(503);
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row).toMatchObject({ status: "failed", failureCode: "trigger_failed" });
  });
});

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
      .where(and(eq(analyticsEvent.creatorId, creator.id), eq(analyticsEvent.takeId, t.id)));
    expect(rows.map((r) => [r.name, r.props])).toEqual([
      ["take_downloaded", { kind: "video" }],
      ["take_downloaded", { kind: "video" }],
    ]);
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

describe("DELETE /api/takes/{id} (spec 0013 AC-3, AC-6)", () => {
  const noopAfter = { cancelRuns: async () => {}, requestStorageDrain: async () => {} };
  const depsWith = (creatorId: string | null, afterDelete = noopAfter): TakeHttpDeps => ({
    ...takeDeps(creatorId),
    afterDelete,
  });

  it("answers 403 for a missing or foreign Origin and deletes nothing", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    for (const origin of ["https://evil.example", null]) {
      const res = await handleDelete(
        req("DELETE", "/x", undefined, origin),
        t.id,
        depsWith(creator.id),
      );
      expect(res.status).toBe(403);
    }
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toHaveLength(1);
  });

  it("answers 204 with no body, removes the take and queues its original, then 404 on a repeat", async () => {
    const creator = await createCreator(db);
    const t = await readyTake(creator.id, { render: "succeeded" });
    const res = await handleDelete(req("DELETE", "/x"), t.id, depsWith(creator.id));
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toEqual([]);
    const queued = await db
      .select({ key: storageDeletion.objectKey })
      .from(storageDeletion)
      .where(eq(storageDeletion.objectKey, t.originalKey));
    expect(queued).toHaveLength(1);

    const again = await handleDelete(req("DELETE", "/x"), t.id, depsWith(creator.id));
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual(NOT_FOUND);
  });

  it("leaves another creator's take alone and gives the same 404", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await seedTake(db, owner.id);
    for (const id of [t.id, "not-a-uuid", crypto.randomUUID()]) {
      const res = await handleDelete(req("DELETE", "/x"), id, depsWith(other.id));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toHaveLength(1);
  });

  it("still answers 204 when the cancel or the drain request fails after the commit", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const failing = {
      cancelRuns: async () => {
        throw new Error("trigger down");
      },
      requestStorageDrain: async () => {
        throw new Error("trigger down");
      },
    };
    const res = await handleDelete(req("DELETE", "/x"), t.id, depsWith(creator.id, failing));
    expect(res.status).toBe(204);
    expect(await db.select({ id: take.id }).from(take).where(eq(take.id, t.id))).toEqual([]);
  });
});
