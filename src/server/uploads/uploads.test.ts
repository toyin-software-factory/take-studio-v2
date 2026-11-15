import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { UPLOAD } from "@/lib/uploads";
import { type UploadDeps } from ".";
import { type HttpDeps, handleCreate } from "./http";
import { MiB, ORIGIN, fakeR2, file, request } from "./uploads-test-helpers";

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
    expect((await handleCreate(request("POST", { ...file, container: "mkv" }), deps)).status).toBe(
      422,
    );
    expect((await handleCreate(request("POST", "not json"), deps)).status).toBe(422);
  });

  it("stores source and a trimmed script, defaulting to a file with no script (spec 0021)", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const deps = httpDeps(creator.id, r2);
    const plain = await created(creator.id, r2);
    const recorded = await handleCreate(
      request("POST", {
        ...file,
        container: "webm",
        source: "recording",
        script: "  Hello there.\n  ",
      }),
      deps,
    );
    expect(recorded.status).toBe(201);
    const { takeId } = (await recorded.json()) as { takeId: string };
    const blank = await handleCreate(request("POST", { ...file, script: "   " }), deps);
    const blankId = ((await blank.json()) as { takeId: string }).takeId;
    const rows = await db.select().from(take).where(eq(take.creatorId, creator.id));
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by(plain.takeId)).toMatchObject({ source: "file", script: null });
    expect(by(takeId)).toMatchObject({
      source: "recording",
      script: "Hello there.",
      container: "webm",
    });
    expect(by(blankId)).toMatchObject({ source: "file", script: null });
  });

  it("answers 422 script_too_long for a script over 20000 characters and never echoes it", async () => {
    const { r2 } = fakeR2();
    const creator = await createCreator(db);
    const deps = httpDeps(creator.id, r2);
    const script = "secret words ".repeat(2000);
    const res = await handleCreate(request("POST", { ...file, script }), deps);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).toContain("script_too_long");
    expect(text).not.toContain("secret words");
    const ok = await handleCreate(request("POST", { ...file, script: "a".repeat(20_000) }), deps);
    expect(ok.status).toBe(201);
    const bad = await handleCreate(request("POST", { ...file, source: "camera" }), deps);
    expect(bad.status).toBe(422);
    const rows = await db.select().from(take).where(eq(take.creatorId, creator.id));
    expect(rows).toHaveLength(1);
  });

  it("never writes the script to a log, on success or refusal (spec 0021 AC-8)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      const { r2 } = fakeR2();
      const creator = await createCreator(db);
      const deps = httpDeps(creator.id, r2);
      const word = "Quince synthetic script words";
      await handleCreate(request("POST", { ...file, script: word }), deps);
      await handleCreate(request("POST", { ...file, script: `${word} `.repeat(2000) }), deps);
      await handleCreate(request("POST", { ...file, script: word, source: "camera" }), deps);
      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      expect(logged).not.toContain("Quince");
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
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
