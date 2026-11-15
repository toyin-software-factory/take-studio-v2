import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type UploadDeps } from ".";
import { type HttpDeps, handleAbort, handleComplete, handleCreate, handleParts } from "./http";
import { ORIGIN, fakeR2, file, request } from "./uploads-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
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
describe("DELETE after complete", () => {
  it("answers 409 and leaves the take alone when the upload already completed", async () => {
    const fake = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, fake.r2);
    const key = `originals/${takeId}/source.mov`;
    fake.stored.set(key, file.sizeBytes);
    // complete ran; the probe hasn't moved the take on yet, so it still says `uploading`.
    await handleComplete(
      request("POST", {
        parts: [1, 2, 3].map((n) => ({ partNumber: n, etag: `e${n}` })),
      }),
      takeId,
      httpDeps(creator.id, fake.r2),
    );

    const res = await handleAbort(request("DELETE"), takeId, httpDeps(creator.id, fake.r2));
    expect(res.status).toBe(409);
    expect(fake.calls.filter((c) => c.startsWith("abort"))).toEqual([]);
    const [row] = await db.select().from(take).where(eq(take.id, takeId));
    expect(row?.status).toBe("uploading");
  });
});
describe("ownership (AC-11)", () => {
  it("gives creator B 404 on creator A's upload for every route, and changes nothing", async () => {
    const fake = fakeR2();
    const a = await createCreator(db);
    const b = await createCreator(db);
    const { takeId } = await created(a.id, fake.r2);
    const deps = httpDeps(b.id, fake.r2);

    expect((await handleParts(request("POST", { partNumbers: [1] }), takeId, deps)).status).toBe(
      404,
    );
    expect(
      (
        await handleComplete(
          request("POST", { parts: [{ partNumber: 1, etag: "x" }] }),
          takeId,
          deps,
        )
      ).status,
    ).toBe(404);
    expect((await handleAbort(request("DELETE"), takeId, deps)).status).toBe(404);
    expect((await handleAbort(request("DELETE"), "not-a-uuid", deps)).status).toBe(404);
    const [row] = await db.select().from(take).where(eq(take.id, takeId));
    expect(row?.status).toBe("uploading");
  });
});
