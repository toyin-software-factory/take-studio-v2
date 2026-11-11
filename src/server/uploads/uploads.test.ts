import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storageDeletion, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { R2CompleteError } from "@/lib/r2";
import { UPLOAD } from "@/lib/uploads";
import type { UploadDeps } from ".";
import { type HttpDeps, handleAbort, handleComplete, handleCreate, handleParts } from "./http";

const ORIGIN = "https://take-studio.example";
const MiB = 1024 * 1024;

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

/** A fake R2 that records calls; behaviour can be overridden per test. */
function fakeR2(overrides: Partial<UploadDeps["r2"]> = {}) {
  const calls: string[] = [];
  const stored = new Map<string, number>();
  const r2: UploadDeps["r2"] = {
    createMultipartUpload: async (key, contentType) => {
      calls.push(`create ${key} ${contentType}`);
      return `mpu-${crypto.randomUUID()}`;
    },
    presignUploadPart: async (key, uploadId, partNumber, expires) =>
      `https://r2.test/${key}?partNumber=${partNumber}&uploadId=${uploadId}&X-Amz-Expires=${expires}`,
    completeMultipartUpload: async (key, _uploadId, parts) => {
      calls.push(`complete ${parts.length}`);
      stored.set(key, stored.get(key) ?? -1);
    },
    abortMultipartUpload: async (key) => void calls.push(`abort ${key}`),
    headObject: async (key) => {
      const size = stored.get(key);
      return size === undefined ? null : { size };
    },
    ...overrides,
  };
  return { r2, calls, stored };
}

/** Handler deps with a fixed signed in creator (or none) and the given fakes. */
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

function request(method: string, body?: unknown, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request("https://take-studio.example/api/uploads", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const file = { fileName: "Morning take.mov", sizeBytes: 40 * MiB, container: "mov" };

async function created(creatorId: string, r2: UploadDeps["r2"], input = file) {
  const res = await handleCreate(request("POST", input), httpDeps(creatorId, r2));
  expect(res.status).toBe(201);
  return (await res.json()) as { takeId: string; partSize: number; partCount: number };
}

describe("guards", () => {
  it("refuses a missing or foreign Origin with 403, and no session with 401", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    expect((await handleCreate(request("POST", file, null), httpDeps(creator.id, r2))).status).toBe(
      403,
    );
    expect(
      (await handleCreate(request("POST", file, "https://evil.example"), httpDeps(creator.id, r2)))
        .status,
    ).toBe(403);
    const res = await handleCreate(request("POST", file), httpDeps(null, r2));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });
});

describe("POST /api/uploads (AC-3, AC-12)", () => {
  it("creates an uploading take with a multipart upload in 16 MiB parts", async () => {
    const { r2, calls } = fakeR2();
    const creator = await createCreator(db);
    const out = await created(creator.id, r2);

    expect(out).toMatchObject({ partSize: 16 * MiB, partCount: 3 });
    const [row] = await db.select().from(take).where(eq(take.id, out.takeId));
    expect(row).toMatchObject({ status: "uploading", title: "Morning take", container: "mov" });
    expect(row?.uploadId).toMatch(/^mpu-/);
    expect(calls).toEqual([`create originals/${out.takeId}/source.mov video/quicktime`]);
  });

  it("refuses files over 2 GB and unsupported types with 422", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const deps = httpDeps(creator.id, r2);
    const tooBig = await handleCreate(
      request("POST", { ...file, sizeBytes: 2 * 1024 ** 3 + 1 }),
      deps,
    );
    expect(tooBig.status).toBe(422);
    expect(await tooBig.json()).toMatchObject({ error: "too_large" });
    expect((await handleCreate(request("POST", { ...file, container: "webm" }), deps)).status).toBe(
      422,
    );
    expect((await handleCreate(request("POST", "not json"), deps)).status).toBe(422);
  });

  it("allows 10 uploads per creator per hour, then answers 429; older takes don't count", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    await seedTake(db, creator.id, { createdAt: new Date(Date.now() - 2 * 3_600_000) });
    for (let i = 0; i < UPLOAD.perHourLimit; i++) await created(creator.id, r2);

    const res = await handleCreate(request("POST", file), httpDeps(creator.id, r2));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
    // Another creator is unaffected.
    const other = await createCreator(db);
    await created(other.id, r2);
  });

  it("fails the take and answers 503 when R2 can't start the upload", async () => {
    const { r2 } = fakeR2({
      createMultipartUpload: async () => {
        throw new Error("R2 create multipart failed: HTTP 500");
      },
    });
    const creator = await createCreator(db);
    const res = await handleCreate(request("POST", file), httpDeps(creator.id, r2));
    expect(res.status).toBe(503);
    const rows = await db.select().from(take).where(eq(take.creatorId, creator.id));
    expect(rows).toMatchObject([{ status: "failed", failureCode: "internal_error" }]);
  });
});

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
