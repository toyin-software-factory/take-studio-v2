import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyticsEvent, appSetting, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { chargedMonth } from "@/lib/billing";
import { usageAccountHash } from "@/lib/usage-hash";
import { usageMonth } from "@/db/schema";
import { type TakeHttpDeps, handleRetry } from "../takes/http";
import { type HttpDeps, handleCreate } from "../uploads/http";
import type { UploadDeps } from "../uploads";
import { handleUsage } from "./http";

/**
 * Spec 0014 steps 4 and 5: GET /api/usage, the early refusal at upload, the retry message and
 * the probe ending (AC-6, AC-7, AC-8, AC-13). Own database: `app_setting` is global.
 */
const ORIGIN = "https://take-studio.example";
const SECRET = "x".repeat(40);
const NOW = new Date("2026-11-10T12:00:00Z");
let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_usage_routes" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

async function setSettings(enabled: boolean, seconds: number): Promise<void> {
  for (const row of [
    { key: "usage_limit_enabled", value: enabled },
    { key: "free_monthly_seconds", value: seconds },
  ]) {
    await db
      .insert(appSetting)
      .values(row)
      .onConflictDoUpdate({ target: appSetting.key, set: { value: row.value } });
  }
}
beforeEach(() => setSettings(true, 100));

async function account(usedSeconds = 0) {
  const creator = await createCreator(db);
  const hash = await usageAccountHash(creator.email, SECRET);
  if (usedSeconds > 0) {
    await db.insert(usageMonth).values({
      accountHash: hash,
      month: chargedMonth(NOW),
      secondsUsed: usedSeconds,
      hashVersion: 1,
    });
  }
  return { creator, hash };
}

const getCreator = (creatorId: string | null) => async () => (creatorId ? { db, creatorId } : null);

describe("GET /api/usage (AC-8)", () => {
  const call = (creatorId: string | null) =>
    handleUsage(new Request("https://x.test/api/usage"), {
      getCreator: getCreator(creatorId),
      usageSecret: () => SECRET,
      now: () => NOW,
    });

  it("needs a session", async () => {
    const res = await call(null);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns exactly the four numbers, private and no-store, with no email or hash", async () => {
    const a = await account(40);
    const res = await call(a.creator.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({
      usedSeconds: 40,
      allowanceSeconds: 100,
      remainingSeconds: 60,
      resetsOn: "2026-12-01",
    });
    expect(JSON.stringify(body)).not.toContain(a.hash);
    expect(JSON.stringify(body)).not.toContain(a.creator.email);
  });

  it("shows only the caller's own usage", async () => {
    const other = await account(90);
    const mine = await account(10);
    expect(other.creator.id).not.toBe(mine.creator.id);
    expect((await (await call(mine.creator.id)).json()).usedSeconds).toBe(10);
  });

  it("answers a friendly 503 when the secret is missing", async () => {
    const a = await account();
    const res = await handleUsage(new Request("https://x.test/api/usage"), {
      getCreator: getCreator(a.creator.id),
      usageSecret: () => {
        throw new Error("missing");
      },
    });
    expect(res.status).toBe(503);
  });
});

describe("early refusal at upload (AC-7, AC-8)", () => {
  let created = 0;
  const uploadDeps = (creatorId: string | null, secret = true): HttpDeps => ({
    allowedOrigin: ORIGIN,
    getCreator: getCreator(creatorId),
    usageSecret: secret ? () => SECRET : undefined,
    now: () => NOW,
    uploadDeps: (d): UploadDeps => ({
      db: d,
      r2: {
        createMultipartUpload: async () => {
          created += 1;
          return "upload-1";
        },
      } as unknown as UploadDeps["r2"],
      dispatchProbe: async () => {},
      now: () => NOW,
    }),
  });
  const create = (creatorId: string, extra: object = {}, secret = true) =>
    handleCreate(
      new Request("https://x.test/api/uploads", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ fileName: "a.mp4", sizeBytes: 1000, container: "mp4", ...extra }),
      }),
      uploadDeps(creatorId, secret),
    );

  it("refuses with 0 seconds left: 403, the four numbers, private no-store, no take made", async () => {
    const a = await account(100);
    created = 0;
    const res = await create(a.creator.id);
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({
      error: "limit_exceeded",
      usedSeconds: 100,
      allowanceSeconds: 100,
      remainingSeconds: 0,
      resetsOn: "2026-12-01",
    });
    expect(created).toBe(0);
    // Spec 0016 AC-4: the refusal is a limit hit at the upload start, with no take.
    const hits = await db
      .select()
      .from(analyticsEvent)
      .where(and(eq(analyticsEvent.creatorId, a.creator.id), eq(analyticsEvent.name, "limit_hit")));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ takeId: null, props: { place: "upload_start" } });
    expect(await db.select().from(take).where(eq(take.creatorId, a.creator.id))).toHaveLength(0);
  });

  it("refuses when the duration hint is more than what is left, allows an exact fit", async () => {
    const a = await account(40);
    expect((await create(a.creator.id, { durationHintMs: 60_001 })).status).toBe(403);
    expect((await create(a.creator.id, { durationHintMs: 60_000 })).status).toBe(201);
  });

  it("ignores the hint when it is missing or bad, and does nothing while the limit is off", async () => {
    const a = await account(40);
    expect((await create(a.creator.id)).status).toBe(201);
    expect((await create(a.creator.id, { durationHintMs: "long" })).status).toBe(201);
    await setSettings(false, 100);
    const full = await account(100);
    expect((await create(full.creator.id, { durationHintMs: 9_999_000 })).status).toBe(201);
  });

  it("lets the upload go on when no secret is configured (the probe still decides)", async () => {
    const a = await account(100);
    expect((await create(a.creator.id, {}, false)).status).toBe(201);
  });
});

describe("retry at the limit (AC-6)", () => {
  const retryDeps = (creatorId: string, triggered: string[]): TakeHttpDeps => ({
    allowedOrigin: ORIGIN,
    getCreator: getCreator(creatorId),
    usageSecret: () => SECRET,
    triggerProcessTake: async (jobId) => {
      triggered.push(jobId);
      return { id: `run_${jobId}` };
    },
    now: () => NOW,
  });
  const retry = (creatorId: string, takeId: string, triggered: string[] = []) =>
    handleRetry(
      new Request(`https://x.test/api/takes/${takeId}/retry`, {
        method: "POST",
        headers: { origin: ORIGIN },
      }),
      takeId,
      retryDeps(creatorId, triggered),
    );

  it("retry says the dated message with the numbers, charges nothing, then works once raised", async () => {
    const a = await account(80);
    const t = await seedTake(db, a.creator.id, {
      durationMs: 30_000,
      status: "failed",
      failureCode: "limit_exceeded",
      videoExpiresAt: new Date("2026-12-05T00:00:00Z"),
    });
    const res = await retry(a.creator.id, t.id);
    expect(res.status).toBe(403);
    const hits = await db
      .select()
      .from(analyticsEvent)
      .where(and(eq(analyticsEvent.creatorId, a.creator.id), eq(analyticsEvent.name, "limit_hit")));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ takeId: t.id, props: { place: "upload_complete" } });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      error: "limit_exceeded",
      message:
        "This month's allowance is used up. Your upload is kept until 5 Dec: try again from 1 Dec, or delete it.",
      usedSeconds: 80,
      allowanceSeconds: 100,
      remainingSeconds: 20,
      resetsOn: "2026-12-01",
    });
    const [m] = await db.select().from(usageMonth).where(eq(usageMonth.accountHash, a.hash));
    expect(m?.secondsUsed).toBe(80);

    await setSettings(true, 200);
    const triggered: string[] = [];
    expect((await retry(a.creator.id, t.id, triggered)).status).toBe(202);
    expect(triggered).toHaveLength(1);
  });

  it("says the video expires before the minutes come back when it does", async () => {
    const a = await account(100);
    const t = await seedTake(db, a.creator.id, {
      durationMs: 30_000,
      status: "failed",
      failureCode: "limit_exceeded",
      videoExpiresAt: new Date("2026-11-20T00:00:00Z"),
    });
    const body = await (await retry(a.creator.id, t.id)).json();
    expect(body.message).toBe(
      "Your upload is kept until 20 Nov, before your minutes come back on 1 Dec. Upload it again then.",
    );
  });
});
