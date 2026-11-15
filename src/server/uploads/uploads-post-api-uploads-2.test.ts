import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyticsEvent, storageDeletion, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { R2CompleteError } from "@/lib/r2";
import { type UploadDeps } from ".";
import { type HttpDeps, handleAbort, handleComplete, handleCreate } from "./http";
import { ORIGIN, fakeR2, file, request } from "./uploads-test-helpers";

/** The recorded events of one name for a creator (spec 0016). */
const eventsOf = (db: Db, creatorId: string, name: string) =>
  db
    .select()
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.creatorId, creatorId), eq(analyticsEvent.name, name)));
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
describe("POST /api/uploads/{takeId}/complete (AC-4)", () => {
  const partsFor = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, etag: `"etag-${i + 1}"` }));

  it("completes, checks the stored size and dispatches the probe", async () => {
    const fake = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, fake.r2);
    fake.stored.set(`originals/${takeId}/source.mov`, file.sizeBytes);
    const dispatched: string[] = [];

    const res = await handleComplete(
      request("POST", { parts: partsFor(3) }),
      takeId,
      httpDeps(creator.id, fake.r2, dispatched),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ takeId, status: "uploading" });
    expect(fake.calls).toContain("complete 3");
    expect(dispatched).toEqual([takeId]);
    // Spec 0016 AC-4: the upload is counted once, before the probe decides anything.
    const events = await eventsOf(db, creator.id, "take_uploaded");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ takeId, props: {} });
  });

  it("is idempotent: a repeat after R2 already completed re-dispatches only under the same probe key", async () => {
    const fake = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, fake.r2);
    fake.stored.set(`originals/${takeId}/source.mov`, file.sizeBytes);
    const dispatched: string[] = [];
    const deps = httpDeps(creator.id, fake.r2, dispatched);
    await handleComplete(request("POST", { parts: partsFor(3) }), takeId, deps);

    // R2 now answers NoSuchUpload: the earlier call completed it.
    fake.r2.completeMultipartUpload = async () => {
      throw new R2CompleteError("NoSuchUpload");
    };
    const again = await handleComplete(request("POST", { parts: partsFor(3) }), takeId, deps);
    expect(again.status).toBe(200);
    // Both dispatches carry the same take, so the `probe-{takeId}` key makes them one run.
    expect(dispatched).toEqual([takeId, takeId]);
    expect(await eventsOf(db, creator.id, "take_uploaded")).toHaveLength(1);
  });

  it("returns the current status without touching R2 once the take moved on", async () => {
    const fake = fakeR2();
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "uploaded" });
    const dispatched: string[] = [];
    const res = await handleComplete(
      request("POST", { parts: partsFor(1) }),
      t.id,
      httpDeps(creator.id, fake.r2, dispatched),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ takeId: t.id, status: "uploaded" });
    expect(fake.calls).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it("rejects a wrong part list (count, order, empty ETag) with 422, before calling R2", async () => {
    const fake = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, fake.r2);
    const deps = httpDeps(creator.id, fake.r2);
    const bad = [
      partsFor(2),
      [partsFor(3)[1], partsFor(3)[0], partsFor(3)[2]],
      partsFor(3).map((p, i) => (i === 1 ? { ...p, etag: '""' } : p)),
    ];
    for (const parts of bad) {
      expect((await handleComplete(request("POST", { parts }), takeId, deps)).status).toBe(422);
    }
    expect(fake.calls.filter((c) => c.startsWith("complete"))).toEqual([]);
  });

  it("fails the take with corrupt_upload and queues the file when the stored size differs", async () => {
    const fake = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, fake.r2);
    const key = `originals/${takeId}/source.mov`;
    fake.stored.set(key, file.sizeBytes - 1);
    const dispatched: string[] = [];

    const res = await handleComplete(
      request("POST", { parts: partsFor(3) }),
      takeId,
      httpDeps(creator.id, fake.r2, dispatched),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "size_mismatch" });
    const [row] = await db.select().from(take).where(eq(take.id, takeId));
    expect(row).toMatchObject({ status: "failed", failureCode: "corrupt_upload", uploadId: null });
    expect(
      await db.select().from(storageDeletion).where(eq(storageDeletion.objectKey, key)),
    ).toHaveLength(1);
    expect(dispatched).toEqual([]);
  });

  it("answers 422 when R2 rejects a part, and 503 when the probe can't be dispatched", async () => {
    const fake = fakeR2({
      completeMultipartUpload: async () => {
        throw new R2CompleteError("InvalidPart");
      },
    });
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, fake.r2);
    expect(
      (
        await handleComplete(
          request("POST", { parts: partsFor(3) }),
          takeId,
          httpDeps(creator.id, fake.r2),
        )
      ).status,
    ).toBe(422);

    const ok = fakeR2();
    const second = await created(creator.id, ok.r2);
    ok.stored.set(`originals/${second.takeId}/source.mov`, file.sizeBytes);
    const res = await handleComplete(
      request("POST", { parts: partsFor(3) }),
      second.takeId,
      httpDeps(creator.id, ok.r2, [], async () => {
        throw new Error("Trigger.dev unavailable");
      }),
    );
    expect(res.status).toBe(503);
    const [row] = await db.select().from(take).where(eq(take.id, second.takeId));
    expect(row?.status).toBe("uploading");
  });
});
describe("DELETE /api/uploads/{takeId}", () => {
  it("aborts the multipart upload and fails the take with upload_abandoned, once", async () => {
    const fake = fakeR2();
    const creator = await createCreator(db);
    const { takeId } = await created(creator.id, fake.r2);
    const deps = httpDeps(creator.id, fake.r2);

    expect((await handleAbort(request("DELETE"), takeId, deps)).status).toBe(200);
    expect(fake.calls).toContain(`abort originals/${takeId}/source.mov`);
    const [row] = await db.select().from(take).where(eq(take.id, takeId));
    expect(row).toMatchObject({
      status: "failed",
      failureCode: "upload_abandoned",
      uploadId: null,
    });
    expect((await handleAbort(request("DELETE"), takeId, deps)).status).toBe(409);
  });
});
