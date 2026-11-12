import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, take, user } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import type { UploadDeps } from ".";
import { type HttpDeps, handleCreate } from "./http";

// Spec 0008, AC-1: the background chosen at upload (POST /api/uploads gains `backgroundId`).
const ORIGIN = "https://take-studio.example";
const FILE = { fileName: "Morning take.mov", sizeBytes: 40 * 1024 * 1024, container: "mov" };

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const r2: UploadDeps["r2"] = {
  createMultipartUpload: async () => `mpu-${crypto.randomUUID()}`,
  presignUploadPart: async () => "https://r2.test/part",
  completeMultipartUpload: async () => undefined,
  abortMultipartUpload: async () => undefined,
  headObject: async () => null,
};

const deps = (creatorId: string): HttpDeps => ({
  allowedOrigin: ORIGIN,
  getCreator: async () => ({ db, creatorId }),
  uploadDeps: (database) => ({ db: database, r2, dispatchProbe: async () => undefined }),
});

const create = (creatorId: string, extra: Record<string, unknown>) =>
  handleCreate(
    new Request("https://take-studio.example/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ ...FILE, ...extra }),
    }),
    deps(creatorId),
  );

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
      alt: "A studio",
      ...over,
    })
    .returning();
  return row!;
}

const takeRow = async (id: string) => (await db.select().from(take).where(eq(take.id, id)))[0];
const defaultOf = async (creatorId: string) =>
  (await db.select().from(user).where(eq(user.id, creatorId)))[0]?.defaultBackgroundId;

describe("POST /api/uploads with a background (AC-1)", () => {
  it("stores a built in studio on the take and as the creator's default, together", async () => {
    const creator = await createCreator(db);
    const studio = await seedBackground();
    const res = await create(creator.id, { backgroundId: studio.id });
    expect(res.status).toBe(201);
    const { takeId } = await res.json();
    expect((await takeRow(takeId))?.backgroundId).toBe(studio.id);
    expect(await defaultOf(creator.id)).toBe(studio.id);
  });

  it("accepts the creator's own ready upload", async () => {
    const creator = await createCreator(db);
    const mine = await seedBackground({ creatorId: creator.id, name: "My wall" });
    const res = await create(creator.id, { backgroundId: mine.id });
    expect(res.status).toBe(201);
    expect(await defaultOf(creator.id)).toBe(mine.id);
  });

  it("`original` clears the take's background and the default", async () => {
    const creator = await createCreator(db);
    const studio = await seedBackground();
    await create(creator.id, { backgroundId: studio.id });
    const res = await create(creator.id, { backgroundId: "original" });
    expect(res.status).toBe(201);
    const { takeId } = await res.json();
    expect((await takeRow(takeId))?.backgroundId).toBeNull();
    expect(await defaultOf(creator.id)).toBeNull();
  });

  it("leaves the default alone when no choice is sent", async () => {
    const creator = await createCreator(db);
    const studio = await seedBackground();
    await create(creator.id, { backgroundId: studio.id });
    const res = await create(creator.id, {});
    expect(res.status).toBe(201);
    expect((await takeRow((await res.json()).takeId))?.backgroundId).toBeNull();
    expect(await defaultOf(creator.id)).toBe(studio.id);
  });

  it("answers 404 for an unknown background and for another creator's, storing nothing", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const theirs = await seedBackground({ creatorId: other.id, name: "Theirs" });
    for (const backgroundId of [crypto.randomUUID(), theirs.id]) {
      const res = await create(creator.id, { backgroundId });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("background_not_found");
    }
    expect(await defaultOf(creator.id)).toBeNull();
    const takes = await db.select().from(take).where(eq(take.creatorId, creator.id));
    expect(takes).toHaveLength(0);
  });

  it("answers 409 background_not_ready for an upload still being processed or failed", async () => {
    const creator = await createCreator(db);
    for (const status of ["uploading", "processing", "failed"]) {
      const mine = await seedBackground({
        creatorId: creator.id,
        status,
        imageKey: null,
        thumbKey: null,
        width: null,
        height: null,
      });
      const res = await create(creator.id, { backgroundId: mine.id });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("background_not_ready");
    }
    expect(await defaultOf(creator.id)).toBeNull();
  });

  it("answers 422 for a background ID that is neither an ID nor `original`", async () => {
    const creator = await createCreator(db);
    for (const backgroundId of ["nope", 5, "", "ORIGINAL"]) {
      expect((await create(creator.id, { backgroundId })).status).toBe(422);
    }
  });

  it("a deleted background falls back to no background on the take it was chosen for", async () => {
    const creator = await createCreator(db);
    const mine = await seedBackground({ creatorId: creator.id });
    const { takeId } = await (await create(creator.id, { backgroundId: mine.id })).json();
    await db.delete(background).where(eq(background.id, mine.id));
    expect((await takeRow(takeId))?.backgroundId).toBeNull();
    expect(await defaultOf(creator.id)).toBeNull();
  });
});
