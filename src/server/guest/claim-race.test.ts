import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { take } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import { completeUpload } from "../uploads/finish";
import { handleGet } from "../takes/http";
import { NOT_FOUND, req } from "../takes/routes-test-helpers";
import { ORIGIN, fakeR2 } from "../uploads/uploads-test-helpers";
import { claimGuest } from "./claim";
import { guestExists, seedAccount, seedGuest, takesOf } from "./claim-test-helpers";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_claim_race" });
});
afterAll(() => testDb?.close());

const parts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, etag: "e" }));

describe("a claim while the upload finishes (spec 0023, AC-4)", () => {
  it("moves a take whose object exists but the probe has not moved yet", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploading"] });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    const { r2, stored } = fakeR2();
    stored.set(g.takes[0]?.originalKey ?? "", 1);
    const res = await claimGuest(
      { db: testDb.db, r2 },
      {
        claimId: g.claimId,
        userId: me.id,
        cookie: g.token,
        confirmed: false,
      },
    );
    expect(res).toMatchObject({ ok: true, data: { kind: "done", pending: [] } });
    expect(await takesOf(testDb.db, me.id)).toHaveLength(1);
    expect(await guestExists(testDb.db, g.guestId)).toBe(false);
  });

  it("parks a take with no object, and the complete route finishes the claim", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploading"] });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    const t = g.takes[0];
    if (!t) throw new Error("no take");
    await testDb.db
      .update(take)
      .set({ uploadId: "mpu", originalBytes: 5 })
      .where(eq(take.id, t.id));
    const { r2, stored } = fakeR2();
    const claim = await claimGuest(
      { db: testDb.db, r2 },
      {
        claimId: g.claimId,
        userId: me.id,
        cookie: g.token,
        confirmed: false,
      },
    );
    expect(claim).toMatchObject({ ok: true, data: { pending: [t.id] } });
    expect(await takesOf(testDb.db, me.id)).toHaveLength(0);

    stored.clear();
    const deps = {
      db: testDb.db,
      r2: { ...r2, headObject: async () => ({ size: 5 }) },
      dispatchProbe: async () => undefined,
    };
    const done = await completeUpload(deps, g.guestId, t.id, { parts: parts(1) });
    expect(done.ok).toBe(true);
    expect((await takesOf(testDb.db, me.id)).map((x) => x.id)).toEqual([t.id]);
    expect(await guestExists(testDb.db, g.guestId)).toBe(false);
  });

  it("answers a take not moved yet like any unknown take (no hint a guest take exists)", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploading"] });
    const me = await seedAccount(testDb.db, `${crypto.randomUUID()}@example.com`);
    await claimGuest(
      { db: testDb.db, r2: fakeR2().r2 },
      {
        claimId: g.claimId,
        userId: me.id,
        cookie: g.token,
        confirmed: false,
      },
    );
    const deps = {
      getCreator: async () => ({ db: testDb.db, creatorId: me.id }),
      allowedOrigin: ORIGIN,
      usageSecret: () => "x".repeat(40),
      triggerProcessTake: async () => ({ id: "run" }),
    };
    const parked = await handleGet(
      req("GET", `/api/takes/${g.takes[0]?.id}`),
      g.takes[0]?.id ?? "",
      deps,
    );
    const random = crypto.randomUUID();
    const unknown = await handleGet(req("GET", `/api/takes/${random}`), random, deps);
    expect(parked.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await parked.json()).toEqual(NOT_FOUND);
    expect(await unknown.json()).toEqual(NOT_FOUND);
  });
});
