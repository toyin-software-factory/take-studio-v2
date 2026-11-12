import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, processingJob, storageDeletion } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { backgroundKeys } from "@/lib/background-rules";
import type { UploadPorts } from "./upload";
import {
  type UploadHttpDeps,
  handleCompleteBackground,
  handleCreateBackground,
  handleDeleteBackground,
} from "./upload-http";

// Spec 0008, AC-8 to AC-10: POST /api/backgrounds, its /complete and DELETE.
const ORIGIN = "https://take-studio.example";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

type Calls = {
  signed: { key: string; contentType: string; bytes: number }[];
  ingested: string[];
  drains: number;
};

function setup(
  creatorId: string | null,
  options: { stored?: boolean; failTrigger?: boolean; failPresign?: boolean } = {},
) {
  const calls: Calls = { signed: [], ingested: [], drains: 0 };
  const deps: UploadHttpDeps = {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    ports: (database): UploadPorts => ({
      db: database,
      presignPut: async (key, contentType, bytes) => {
        if (options.failPresign) throw new Error("r2 down");
        calls.signed.push({ key, contentType, bytes });
        return `https://r2.test/${key}?X-Amz-Expires=900`;
      },
      headObject: async () => (options.stored === false ? null : { size: 1000 }),
      triggerIngest: async (id) => {
        if (options.failTrigger) throw new Error("trigger down");
        calls.ingested.push(id);
      },
    }),
    requestDrain: async () => void (calls.drains += 1),
  };
  return { deps, calls };
}

const req = (method: string, body?: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/backgrounds`, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const GOOD = { name: "My wall", contentType: "image/jpeg", bytes: 2_000_000 };
const create = (s: ReturnType<typeof setup>, body: unknown = GOOD) =>
  handleCreateBackground(req("POST", body), s.deps);

describe("POST /api/backgrounds", () => {
  it("answers 403 without a good Origin and 401 without a session", async () => {
    const creator = await createCreator(db);
    expect(
      (await handleCreateBackground(req("POST", GOOD, null), setup(creator.id).deps)).status,
    ).toBe(403);
    expect((await handleCreateBackground(req("POST", GOOD), setup(null).deps)).status).toBe(401);
  });

  it("creates the row and hands out a PUT link signed for the type and the exact length", async () => {
    const creator = await createCreator(db);
    const s = setup(creator.id);
    const res = await create(s);
    expect(res.status).toBe(201);
    const { id, uploadUrl } = await res.json();
    const keys = backgroundKeys(creator.id, id);
    expect(s.calls.signed).toEqual([
      { key: keys.sourceKey, contentType: "image/jpeg", bytes: 2_000_000 },
    ]);
    expect(uploadUrl).toContain(keys.sourceKey);
    const [row] = await db.select().from(background).where(eq(background.id, id));
    expect(row).toMatchObject({ status: "uploading", name: "My wall", bytes: 2_000_000 });
  });

  it("accepts JPEG, PNG and WebP only (422 unsupported_type otherwise)", async () => {
    const creator = await createCreator(db);
    for (const contentType of ["image/png", "image/webp"]) {
      expect((await create(setup(creator.id), { ...GOOD, contentType })).status).toBe(201);
    }
    for (const contentType of [
      "image/gif",
      "application/pdf",
      "image/svg+xml",
      "video/mp4",
      "IMAGE/JPEG",
    ]) {
      const res = await create(setup(creator.id), { ...GOOD, contentType });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("unsupported_type");
    }
  });

  it("refuses over 10 MB (too_large) and a bad name or size (invalid), creating nothing", async () => {
    const creator = await createCreator(db);
    const big = await create(setup(creator.id), { ...GOOD, bytes: 10 * 1024 * 1024 + 1 });
    expect(big.status).toBe(422);
    expect((await big.json()).error).toBe("too_large");
    expect((await create(setup(creator.id), { ...GOOD, bytes: 10 * 1024 * 1024 })).status).toBe(
      201,
    );
    for (const bad of [
      { ...GOOD, name: "" },
      { ...GOOD, name: "   " },
      { ...GOOD, name: "x".repeat(81) },
      { ...GOOD, bytes: 0 },
      { ...GOOD, bytes: 1.5 },
      { ...GOOD, bytes: "9" },
      {},
    ]) {
      const res = await create(setup(creator.id), bad);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("invalid");
    }
    const rows = await db.select().from(background).where(eq(background.creatorId, creator.id));
    expect(rows).toHaveLength(1);
  });

  it("answers 429 after 20 in an hour and 409 library_full at 100", async () => {
    const creator = await createCreator(db);
    for (let i = 0; i < 20; i += 1) expect((await create(setup(creator.id))).status).toBe(201);
    const limited = await create(setup(creator.id));
    expect(limited.status).toBe(429);
    expect((await limited.json()).message).toContain("20 backgrounds");

    const full = await createCreator(db);
    await db.insert(background).values(
      Array.from({ length: 100 }, (_, i) => ({
        id: crypto.randomUUID(),
        creatorId: full.id,
        name: `Old ${i}`,
        status: "failed",
        createdAt: new Date(Date.now() - 2 * 3_600_000),
      })),
    );
    const res = await create(setup(full.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("library_full");
  });

  it("answers 503 when R2 cannot sign", async () => {
    const creator = await createCreator(db);
    const res = await create(setup(creator.id, { failPresign: true }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("storage_error");
  });
});

async function uploaded(creatorId: string) {
  const res = await create(setup(creatorId));
  return (await res.json()).id as string;
}
const complete = (s: ReturnType<typeof setup>, id: string) =>
  handleCompleteBackground(req("POST"), id, s.deps);

describe("POST /api/backgrounds/{id}/complete", () => {
  it("moves to processing and starts ingest once", async () => {
    const creator = await createCreator(db);
    const id = await uploaded(creator.id);
    const s = setup(creator.id);
    const res = await complete(s, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "processing" });
    expect(s.calls.ingested).toEqual([id]);
    const again = await complete(setup(creator.id), id);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("not_uploaded");
  });

  it("answers 409 not_uploaded when nothing was stored, leaving it uploading", async () => {
    const creator = await createCreator(db);
    const id = await uploaded(creator.id);
    const s = setup(creator.id, { stored: false });
    expect((await complete(s, id)).status).toBe(409);
    expect(s.calls.ingested).toHaveLength(0);
    const [row] = await db.select().from(background).where(eq(background.id, id));
    expect(row?.status).toBe("uploading");
  });

  it("answers 404 for another creator's, an unknown and a malformed ID (AC-9)", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const theirs = await uploaded(other.id);
    for (const id of [theirs, crypto.randomUUID(), "nope"]) {
      expect((await complete(setup(creator.id), id)).status).toBe(404);
    }
  });

  it("fails the row and answers 503 when ingest cannot be started", async () => {
    const creator = await createCreator(db);
    const id = await uploaded(creator.id);
    const res = await complete(setup(creator.id, { failTrigger: true }), id);
    expect(res.status).toBe(503);
    const [row] = await db.select().from(background).where(eq(background.id, id));
    expect(row).toMatchObject({ status: "failed", failureCode: "ingest_error" });
  });

  it("checks Origin and session", async () => {
    const creator = await createCreator(db);
    const id = await uploaded(creator.id);
    const noOrigin = await handleCompleteBackground(
      req("POST", undefined, null),
      id,
      setup(creator.id).deps,
    );
    expect(noOrigin.status).toBe(403);
    expect((await handleCompleteBackground(req("POST"), id, setup(null).deps)).status).toBe(401);
  });
});

async function readyOne(creatorId: string) {
  const id = await uploaded(creatorId);
  await complete(setup(creatorId), id);
  const k = backgroundKeys(creatorId, id);
  await db
    .update(background)
    .set({ status: "ready", imageKey: k.imageKey, thumbKey: k.thumbKey, width: 1920, height: 1080 })
    .where(eq(background.id, id));
  return { id, keys: k };
}
const remove = (s: ReturnType<typeof setup>, id: string) =>
  handleDeleteBackground(req("DELETE"), id, s.deps);

describe("DELETE /api/backgrounds/{id}", () => {
  it("answers 204, removes the row, queues the files and asks for a drain", async () => {
    const creator = await createCreator(db);
    const { id, keys } = await readyOne(creator.id);
    const s = setup(creator.id);
    const res = await remove(s, id);
    expect(res.status).toBe(204);
    expect(s.calls.drains).toBe(1);
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(0);
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toEqual(expect.arrayContaining([keys.sourceKey, keys.imageKey, keys.thumbKey]));
  });

  it("keeps an unfinished upload hidden while its upload link could be live, queueing its files now", async () => {
    const creator = await createCreator(db);
    const id = await uploaded(creator.id); // still `uploading`, link just handed out
    const res = await remove(setup(creator.id), id);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(background).where(eq(background.id, id));
    expect(row).toMatchObject({ status: "failed", failureCode: "removed" });
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toContain(backgroundKeys(creator.id, id).sourceKey);
    // A removed upload cannot be completed.
    expect((await complete(setup(creator.id), id)).status).toBe(409);
  });

  it("answers 404 for another creator's and a built in background, deleting nothing (AC-9)", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const theirs = await readyOne(other.id);
    const builtIn = crypto.randomUUID();
    await db.insert(background).values({
      id: builtIn,
      creatorId: null,
      name: "Built in",
      status: "ready",
      imageKey: "b/i.jpg",
      thumbKey: "b/t.webp",
      width: 1920,
      height: 1080,
    });
    for (const id of [theirs.id, builtIn, "nope"]) {
      expect((await remove(setup(creator.id), id)).status).toBe(404);
    }
    expect(await db.select().from(background).where(eq(background.id, theirs.id))).toHaveLength(1);
    expect(await db.select().from(background).where(eq(background.id, builtIn))).toHaveLength(1);
    await db.delete(background).where(eq(background.id, builtIn));
  });

  it("answers 409 In use while a job renders with it", async () => {
    const creator = await createCreator(db);
    const { id } = await readyOne(creator.id);
    const t = await seedTake(db, creator.id, { status: "ready" });
    await db.insert(processingJob).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "rerender",
      status: "running",
      secondsCharged: 0,
      targetBackgroundId: id,
    });
    const res = await remove(setup(creator.id), id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "in_use",
      message: "In use, try again in a minute.",
    });
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(1);
  });

  it("checks Origin and session", async () => {
    const creator = await createCreator(db);
    const { id } = await readyOne(creator.id);
    expect(
      (await handleDeleteBackground(req("DELETE", undefined, null), id, setup(creator.id).deps))
        .status,
    ).toBe(403);
    expect((await handleDeleteBackground(req("DELETE"), id, setup(null).deps)).status).toBe(401);
  });
});
