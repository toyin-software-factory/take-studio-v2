import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { analyticsEvent, cut } from "@/db/schema";
import { createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { TakeHttpDeps } from "./http";
import { handleMissed, utcDayStart } from "./missed";

const test = await openTestDb({ database: "take_studio_test_missed" });
const { db } = test;
const ORIGIN = "https://take-studio.example";

afterAll(async () => {
  await test.close();
});

const deps = (creatorId: string | null, now?: Date): TakeHttpDeps => ({
  allowedOrigin: ORIGIN,
  getCreator: async () => (creatorId ? { db, creatorId } : null),
  usageSecret: () => "x".repeat(40),
  triggerProcessTake: async () => ({ id: "run" }),
  ...(now ? { now: () => now } : {}),
});
const post = (body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
const marks = (takeId: string) =>
  db
    .select()
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.takeId, takeId), eq(analyticsEvent.name, "cut_missed")));

describe("POST /api/takes/{id}/missed (spec 0017, AC-2 to AC-4)", () => {
  it("records a rounded time and the edited length, writes no cut, answers 204", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id, { status: "ready", durationMs: 60_000 });
    await db.insert(cut).values([
      {
        id: crypto.randomUUID(),
        takeId: t.id,
        startMs: 1000,
        endMs: 3000,
        kind: "filler",
        proposedBy: "ai",
        applied: true,
      },
      {
        id: crypto.randomUUID(),
        takeId: t.id,
        startMs: 10_000,
        endMs: 15_000,
        kind: "pause",
        proposedBy: "ai",
        applied: false,
      },
    ]);
    const res = await handleMissed(post({ atMs: 7_049 }), t.id, deps(c.id));
    expect(res.status).toBe(204);
    expect((await marks(t.id)).map((r) => r.props)).toEqual([{ atMs: 7000, durationMs: 58_000 }]);
    expect(await db.select().from(cut).where(eq(cut.takeId, t.id))).toHaveLength(2);
  });

  it("is 403 for a wrong Origin, 401 signed out, 404 for another creator's take", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await seedTake(db, owner.id, { status: "ready" });
    expect(
      (await handleMissed(post({ atMs: 1 }, "https://evil.example"), t.id, deps(owner.id))).status,
    ).toBe(403);
    expect((await handleMissed(post({ atMs: 1 }), t.id, deps(null))).status).toBe(401);
    expect((await handleMissed(post({ atMs: 1 }), t.id, deps(other.id))).status).toBe(404);
    expect((await handleMissed(post({ atMs: 1 }), "not-a-uuid", deps(owner.id))).status).toBe(404);
    expect(await marks(t.id)).toHaveLength(0);
  });

  it("is 409 for an expired or not ready take", async () => {
    const c = await createCreator(db);
    const expired = await seedTake(db, c.id, { status: "expired", videoExpiresAt: new Date(0) });
    const processing = await seedTake(db, c.id, { status: "processing" });
    expect((await handleMissed(post({ atMs: 1 }), expired.id, deps(c.id))).status).toBe(409);
    expect((await handleMissed(post({ atMs: 1 }), processing.id, deps(c.id))).status).toBe(409);
  });

  it("is 422 for a bad body or a time past the edited length", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id, { status: "ready", durationMs: 10_000 });
    for (const body of [
      { atMs: 10_001 },
      { atMs: -1 },
      { atMs: 1.5 },
      { atMs: "7" },
      {},
      { atMs: 1, why: "x" },
    ]) {
      expect((await handleMissed(post(body), t.id, deps(c.id))).status, JSON.stringify(body)).toBe(
        422,
      );
    }
    expect((await handleMissed(post({ atMs: 10_000 }), t.id, deps(c.id))).status).toBe(204);
    expect(await marks(t.id)).toHaveLength(1);
  });

  it("records 20 a day; the 21st answers 204 without writing; a new UTC day counts again", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id, { status: "ready", durationMs: 60_000 });
    const now = new Date();
    for (let i = 0; i < 21; i++) {
      expect((await handleMissed(post({ atMs: i * 100 }), t.id, deps(c.id, now))).status).toBe(204);
    }
    expect(await marks(t.id)).toHaveLength(20);
    const tomorrow = new Date(utcDayStart(now).getTime() + 36 * 60 * 60 * 1000);
    await handleMissed(post({ atMs: 5 }), t.id, deps(c.id, tomorrow));
    // The take is not expired at that instant (30 days), and the new day starts a new count.
    expect(await marks(t.id)).toHaveLength(21);
  });

  it("never passes 20 a day when presses arrive at the same time", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id, { status: "ready", durationMs: 60_000 });
    const now = new Date();
    for (let i = 0; i < 19; i++) await handleMissed(post({ atMs: i * 100 }), t.id, deps(c.id, now));
    const statuses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        handleMissed(post({ atMs: 2000 + i * 100 }), t.id, deps(c.id, now)).then((r) => r.status),
      ),
    );
    expect(statuses.every((s) => s === 204)).toBe(true);
    expect(await marks(t.id)).toHaveLength(20);
  });
});
