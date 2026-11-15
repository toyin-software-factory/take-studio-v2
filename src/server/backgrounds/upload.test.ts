import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { backgroundKeys } from "@/lib/background-rules";
import type { UploadPorts } from "./upload";
import {
  type UploadHttpDeps,
  handleCompleteBackground,
  handleCreateBackground,
} from "./upload-http";
import { GOOD, ORIGIN, req, type Calls } from "./upload-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
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
const create = (s: ReturnType<typeof setup>, body: unknown = GOOD) =>
  handleCreateBackground(req("POST", body), s.deps);
async function uploaded(creatorId: string) {
  const res = await create(setup(creatorId));
  return (await res.json()).id as string;
}
const complete = (s: ReturnType<typeof setup>, id: string) =>
  handleCompleteBackground(req("POST"), id, s.deps);
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
