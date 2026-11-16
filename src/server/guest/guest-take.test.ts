import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guestClaim, processingJob, render, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import { GUEST_COOKIE } from "@/lib/guest-rules";
import { seedGuest } from "./claim-test-helpers";
import { type GuestTakeDeps, handleGuestTake } from "./take";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_take" });
});
afterAll(() => testDb?.close());

const BASE = "https://take-studio.example/api/guest/take";
const get = (cookie?: string, query = "") =>
  new Request(`${BASE}${query}`, {
    headers: cookie ? { cookie: `${GUEST_COOKIE}=${cookie}` } : {},
  });

function deps(presigned: string[] = []): GuestTakeDeps {
  return {
    getDb: async () => testDb.db,
    headObject: async () => ({ size: 1 }),
    presignGet: async (key, options) => {
      presigned.push(`${key} ${options.disposition.type}`);
      return `https://r2.test/${key}?X-Amz-Expires=${options.expiresSeconds}`;
    },
  };
}

async function addRender(takeId: string) {
  const jobId = crypto.randomUUID();
  await testDb.db.insert(processingJob).values({
    id: jobId,
    takeId,
    kind: "initial",
    status: "succeeded",
    secondsCharged: 0,
  });
  const renderId = crypto.randomUUID();
  await testDb.db.insert(render).values({
    id: renderId,
    takeId,
    jobId,
    status: "succeeded",
    videoKey: `renders/${takeId}/${renderId}.mp4`,
    durationMs: 8_000,
    removedRanges: [],
    isLatest: true,
  });
  return renderId;
}

describe("GET /api/guest/take, the view only result (spec 0023, AC-10)", () => {
  it("gives a ready take's status and a short lived inline play link, and nothing else", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["ready"] });
    const t = g.takes[0]!;
    const renderId = await addRender(t.id);
    const presigned: string[] = [];
    const res = await handleGuestTake(get(g.token), deps(presigned));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["expiresInSeconds", "playUrl", "status"]);
    expect(json.status).toBe("ready");
    expect(json.playUrl).toContain(`renders/${t.id}/${renderId}.mp4`);
    expect(json.expiresInSeconds).toBe(3600);
    expect(presigned).toEqual([`renders/${t.id}/${renderId}.mp4 inline`]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = JSON.stringify(json);
    expect(text).not.toContain("transcript");
    expect(text).not.toContain(t.title);
  });

  it("gives the status and no link while the take is not ready", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["uploaded"] });
    const presigned: string[] = [];
    const res = await handleGuestTake(get(g.token), deps(presigned));
    expect(await res.json()).toEqual({ status: "uploaded", playUrl: null, expiresInSeconds: null });
    expect(presigned).toEqual([]);
  });

  it("refuses no cookie, an unknown cookie, another guest's take and a bad take id", async () => {
    const mine = await seedGuest(testDb.db, { statuses: ["ready"] });
    const other = await seedGuest(testDb.db, { statuses: ["ready"] });
    await addRender(mine.takes[0]!.id);
    expect((await handleGuestTake(get(), deps())).status).toBe(404);
    expect((await handleGuestTake(get("tok-unknown"), deps())).status).toBe(404);
    const foreign = await handleGuestTake(get(mine.token, `?takeId=${other.takes[0]!.id}`), deps());
    expect(foreign.status).toBe(404);
    expect((await handleGuestTake(get(mine.token, "?takeId=nope"), deps())).status).toBe(404);
    const own = await handleGuestTake(get(mine.token, `?takeId=${mine.takes[0]!.id}`), deps());
    expect(own.status).toBe(200);
  });

  it("refuses a signed in account's take, a claimed guest and an expired one", async () => {
    const account = await createCreator(testDb.db);
    const accountTake = await seedTake(testDb.db, account.id, { status: "ready" });
    const g = await seedGuest(testDb.db, { statuses: ["ready"] });
    // A guest cookie never reaches a take owned by a real account.
    expect((await handleGuestTake(get(g.token, `?takeId=${accountTake.id}`), deps())).status).toBe(
      404,
    );

    const claimed = await seedGuest(testDb.db, { statuses: ["ready"] });
    await testDb.db
      .update(guestClaim)
      .set({ claimedAt: new Date() })
      .where(eq(guestClaim.id, claimed.claimId));
    expect((await handleGuestTake(get(claimed.token), deps())).status).toBe(404);

    const expired = await seedGuest(testDb.db, { statuses: ["ready"] });
    await testDb.db
      .update(guestClaim)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(guestClaim.id, expired.claimId));
    expect((await handleGuestTake(get(expired.token), deps())).status).toBe(404);
  });

  it("gives no link for a take whose video expired", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["ready"] });
    await addRender(g.takes[0]!.id);
    await testDb.db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, g.takes[0]!.id));
    const json = await (await handleGuestTake(get(g.token), deps())).json();
    expect(json.playUrl).toBeNull();
  });

  it("answers a storage error with 503 and no link", async () => {
    const g = await seedGuest(testDb.db, { statuses: ["ready"] });
    await addRender(g.takes[0]!.id);
    const broken: GuestTakeDeps = {
      ...deps(),
      headObject: async () => {
        throw new Error("boom");
      },
    };
    expect((await handleGuestTake(get(g.token), broken)).status).toBe(503);
  });
});
