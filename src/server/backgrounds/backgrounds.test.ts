import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, user } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type BackgroundHttpDeps, handleListBackgrounds } from "./http";

// Spec 0008, AC-1 and AC-9: the picker's list (GET /api/backgrounds).
const ORIGIN = "https://take-studio.example";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_backgrounds" });
  db = testDb.db;
  // This file lists every built in, so it owns its database and starts with none.
  await db.delete(background);
});
afterAll(() => testDb?.close());

function deps(creatorId: string | null): { deps: BackgroundHttpDeps; signed: string[] } {
  const signed: string[] = [];
  return {
    signed,
    deps: {
      allowedOrigin: ORIGIN,
      getCreator: async () => (creatorId ? { db, creatorId } : null),
      presignGet: async (key, { expiresSeconds }) => {
        signed.push(key);
        return `https://r2.test/${key}?X-Amz-Expires=${expiresSeconds}`;
      },
    },
  };
}

const list = (creatorId: string | null) => {
  const d = deps(creatorId);
  return handleListBackgrounds(new Request(`${ORIGIN}/api/backgrounds`), d.deps).then((res) => ({
    res,
    signed: d.signed,
  }));
};

let n = 0;
async function seed(over: Partial<typeof background.$inferInsert> = {}) {
  n += 1;
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(background)
    .values({
      id,
      creatorId: null,
      name: `Studio ${n}`,
      imageKey: `backgrounds/x/${id}.jpg`,
      thumbKey: `backgrounds/x/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
      alt: `Alt ${n}`,
      createdAt: new Date(Date.now() + n * 1000),
      ...over,
    })
    .returning();
  return row!;
}

describe("GET /api/backgrounds", () => {
  it("answers 401 without a session", async () => {
    const { res } = await list(null);
    expect(res.status).toBe(401);
  });

  it("lists the built ins, then the creator's own newest first, with 1 hour thumbnail links", async () => {
    const creator = await createCreator(db);
    const studio = await seed({ name: "Studio one", alt: "A calm studio" });
    const older = await seed({ creatorId: creator.id, name: "Older wall", alt: null });
    const newer = await seed({ creatorId: creator.id, name: "Newer wall", alt: null });
    const { res, signed } = await list(creator.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.builtIn.map((b: { id: string }) => b.id)).toEqual([studio.id]);
    expect(body.mine.map((b: { id: string }) => b.id)).toEqual([newer.id, older.id]);
    expect(body.builtIn[0]).toEqual({
      id: studio.id,
      name: "Studio one",
      alt: "A calm studio",
      status: "ready",
      thumbUrl: `https://r2.test/${studio.thumbKey}?X-Amz-Expires=3600`,
    });
    // An upload uses its name as its alt text.
    expect(body.mine[0].alt).toBe("Newer wall");
    expect(signed).toContain(newer.thumbKey);
  });

  it("never lists another creator's backgrounds (AC-9)", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const theirs = await seed({ creatorId: other.id, name: "Theirs" });
    const { res, signed } = await list(creator.id);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(theirs.id);
    expect(signed).not.toContain(theirs.thumbKey);
  });

  it("shows an upload that is not ready with no thumbnail link", async () => {
    const creator = await createCreator(db);
    const pending = await seed({
      creatorId: creator.id,
      status: "processing",
      imageKey: null,
      thumbKey: null,
      width: null,
      height: null,
    });
    const { res } = await list(creator.id);
    const mine = (await res.json()).mine;
    expect(mine.find((b: { id: string }) => b.id === pending.id)).toMatchObject({
      status: "processing",
      thumbUrl: null,
    });
  });

  it("lists at most 100 of the creator's own", async () => {
    const creator = await createCreator(db);
    await db.insert(background).values(
      Array.from({ length: 103 }, (_, i) => ({
        id: crypto.randomUUID(),
        creatorId: creator.id,
        name: `Bulk ${i}`,
        status: "failed",
        createdAt: new Date(Date.now() + 100_000 + i),
      })),
    );
    const { res } = await list(creator.id);
    expect((await res.json()).mine).toHaveLength(100);
  });

  it("reads the creator's last pick from the database, and only while it is usable (defaultId)", async () => {
    const creator = await createCreator(db);
    const studio = await seed();
    const mine = await seed({ creatorId: creator.id });
    const pick = async (id: string | null) => {
      await db.update(user).set({ defaultBackgroundId: id }).where(eq(user.id, creator.id));
      return (await (await list(creator.id)).res.json()).defaultId;
    };
    expect(await pick(null)).toBeNull();
    expect(await pick(studio.id)).toBe(studio.id);
    expect(await pick(mine.id)).toBe(mine.id);
    // Not ready any more: fall back to "Keep original".
    await db.update(background).set({ status: "failed" }).where(eq(background.id, mine.id));
    expect(await pick(mine.id)).toBeNull();
    // Deleted: the foreign key clears it, and the answer is still null.
    await db.delete(background).where(eq(background.id, studio.id));
    expect((await (await list(creator.id)).res.json()).defaultId).toBeNull();
  });
});
