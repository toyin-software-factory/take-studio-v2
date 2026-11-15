import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type UploadDeps, presignParts } from ".";
import { type HttpDeps, handleCreate, handleParts } from "./http";
import { MiB, ORIGIN, fakeR2, file, request } from "./uploads-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_uploads_post_api_uploads" });
  db = testDb.db;
});
afterAll(() =>
  testDb?.close(),
); /** Handler deps with a fixed signed in creator (or none) and the given fakes. */
function httpDeps(
  creatorId: string | null,
  r2: UploadDeps["r2"],
  dispatched: string[] = [],
  dispatchProbe: UploadDeps["dispatchProbe"] = async (takeId) => void dispatched.push(takeId),
): HttpDeps {
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    uploadDeps: (database) => ({ db: database, r2, dispatchProbe }),
  };
}
async function created(creatorId: string, r2: UploadDeps["r2"], input = file) {
  const res = await handleCreate(request("POST", input), httpDeps(creatorId, r2));
  expect(res.status).toBe(201);
  return (await res.json()) as { takeId: string; partSize: number; partCount: number };
}
describe("POST /api/uploads/{takeId}/parts (AC-3, AC-12)", () => {
  it("returns 15 minute links for part numbers within the part count", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, r2);

    const res = await handleParts(
      request("POST", { partNumbers: [1, 2, 3] }),
      takeId,
      httpDeps(creator.id, r2),
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      parts: { partNumber: number; url: string }[];
      expiresInSeconds: number;
    };
    expect(out.expiresInSeconds).toBe(900);
    expect(out.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(out.parts[0]?.url).toContain("X-Amz-Expires=900");
  });

  it("rejects part numbers outside the count, duplicates and too many at once", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, r2);
    const deps = httpDeps(creator.id, r2);
    for (const partNumbers of [[4], [0], [1, 1], Array.from({ length: 51 }, (_, i) => i + 1), []]) {
      const res = await handleParts(request("POST", { partNumbers }), takeId, deps);
      expect(res.status, JSON.stringify(partNumbers)).toBe(422);
    }
  });

  it("answers 409 once the take is no longer uploading", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "uploaded" });
    const res = await handleParts(
      request("POST", { partNumbers: [1] }),
      t.id,
      httpDeps(creator.id, r2),
    );
    expect(res.status).toBe(409);
  });
});
describe("part links keep a slow upload alive (AC-18)", () => {
  const touched = async (id: string) =>
    (await db.select().from(take).where(eq(take.id, id)))[0]?.updatedAt.getTime() ?? 0;
  const links = (creatorId: string, r2: UploadDeps["r2"], takeId: string, now: Date) =>
    presignParts(
      { db, r2, dispatchProbe: async () => undefined, now: () => now },
      creatorId,
      takeId,
      { partNumbers: [1] },
    );

  it("touches the take's updated_at when it issues links, at most once a minute", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, {
      status: "uploading",
      uploadId: "mpu-1",
      originalBytes: 40 * MiB,
      updatedAt: new Date("2026-11-11T10:00:00Z"),
    });
    const t0 = new Date("2026-11-11T12:00:00Z");
    expect((await links(creator.id, r2, t.id, t0)).ok).toBe(true);
    expect(await touched(t.id)).toBe(t0.getTime());
    // Ten seconds later: no new write.
    expect((await links(creator.id, r2, t.id, new Date(t0.getTime() + 10_000))).ok).toBe(true);
    expect(await touched(t.id)).toBe(t0.getTime());
    // A minute and a bit later: written again.
    const t1 = new Date(t0.getTime() + 61_000);
    expect((await links(creator.id, r2, t.id, t1)).ok).toBe(true);
    expect(await touched(t.id)).toBe(t1.getTime());
  });

  it("does not touch a take that is not uploading, or one that is refused", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const old = new Date("2026-11-11T10:00:00Z");
    const done = await seedTake(db, creator.id, { status: "uploaded", updatedAt: old });
    const badParts = await seedTake(db, creator.id, {
      status: "uploading",
      uploadId: "mpu-2",
      originalBytes: 40 * MiB,
      updatedAt: old,
    });
    const now = new Date("2026-11-11T12:00:00Z");
    expect((await links(creator.id, r2, done.id, now)).ok).toBe(false);
    expect(await touched(done.id)).toBe(old.getTime());
    const bad = await presignParts(
      { db, r2, dispatchProbe: async () => undefined, now: () => now },
      creator.id,
      badParts.id,
      { partNumbers: [99] },
    );
    expect(bad.ok).toBe(false);
    expect(await touched(badParts.id)).toBe(old.getTime());
  });

  it("does not touch another creator's take (not found)", async () => {
    const { r2 } = fakeR2();
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const old = new Date("2026-11-11T10:00:00Z");
    const t = await seedTake(db, owner.id, {
      status: "uploading",
      uploadId: "mpu-3",
      originalBytes: 40 * MiB,
      updatedAt: old,
    });
    const res = await links(other.id, r2, t.id, new Date("2026-11-11T12:00:00Z"));
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(await touched(t.id)).toBe(old.getTime());
  });
});
