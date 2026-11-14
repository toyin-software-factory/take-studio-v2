import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { analyticsEvent, take, user } from "@/db/schema";
import { createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import { recordEvent } from "./record";
import { funnel, windowStart } from "./report";

const test = await openTestDb({ database: "take_studio_test_analytics" });
const { db } = test;
const rows = (creatorId: string) =>
  db.select().from(analyticsEvent).where(eq(analyticsEvent.creatorId, creatorId));

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
  await test.close();
});

describe("recordEvent (spec 0016, AC-4, AC-6)", () => {
  it("records signup once per creator, even when called twice", async () => {
    const c = await createCreator(db);
    expect(await recordEvent(db, { name: "signup", creatorId: c.id })).toEqual({
      ok: true,
      data: true,
    });
    expect(await recordEvent(db, { name: "signup", creatorId: c.id })).toEqual({
      ok: true,
      data: false,
    });
    expect(await rows(c.id)).toHaveLength(1);
  });

  it("records a take milestone once per take and name, repeatable events every time", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id);
    for (let i = 0; i < 2; i++) {
      await recordEvent(db, { name: "take_uploaded", creatorId: c.id, takeId: t.id });
      await recordEvent(db, {
        name: "take_downloaded",
        creatorId: c.id,
        takeId: t.id,
        props: { kind: "video" },
      });
    }
    const all = await rows(c.id);
    expect(all.filter((r) => r.name === "take_uploaded")).toHaveLength(1);
    expect(all.filter((r) => r.name === "take_downloaded")).toHaveLength(2);
  });

  it("refuses bad props without writing, and never throws on a failed insert", async () => {
    const c = await createCreator(db);
    const bad = await recordEvent(db, {
      name: "take_failed",
      creatorId: c.id,
      props: { code: "free text" } as never,
    });
    expect(bad).toEqual({ ok: false, error: "invalid" });
    const missingCreator = await recordEvent(db, { name: "signup", creatorId: "no-such-user" });
    expect(missingCreator).toEqual({ ok: false, error: "failed" });
    expect(await rows(c.id)).toHaveLength(0);
  });

  it("logs the event name and take ID only", async () => {
    const spy = vi.mocked(console.error);
    spy.mockClear();
    await recordEvent(db, { name: "signup", creatorId: "no-such-user" });
    expect(spy.mock.calls[0]).toEqual(["analytics event failed", { name: "signup", takeId: null }]);
  });

  it("deleting a take keeps the event with a null take ID; deleting the account removes events", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id);
    await recordEvent(db, { name: "take_uploaded", creatorId: c.id, takeId: t.id });
    await db.delete(take).where(eq(take.id, t.id));
    expect((await rows(c.id))[0]?.takeId).toBeNull();
    await db.delete(user).where(eq(user.id, c.id));
    expect(await rows(c.id)).toHaveLength(0);
  });
});

describe("funnel (spec 0016, AC-7)", () => {
  it("counts signups inside the window", async () => {
    const now = new Date();
    const before = {
      w7: (await funnel(db, "7d", now)).signedUp,
      w30: (await funnel(db, "30d", now)).signedUp,
      all: (await funnel(db, "all", now)).signedUp,
    };
    const day = 24 * 60 * 60 * 1000;
    for (const ageDays of [1, 20, 60]) {
      const c = await createCreator(db);
      await recordEvent(db, {
        name: "signup",
        creatorId: c.id,
        occurredAt: new Date(now.getTime() - ageDays * day),
      });
    }
    const w7 = await funnel(db, "7d", now);
    const w30 = await funnel(db, "30d", now);
    const all = await funnel(db, "all", now);
    expect(w7.signedUp - before.w7).toBe(1);
    expect(w30.signedUp - before.w30).toBe(2);
    expect(all.signedUp - before.all).toBe(3);
  });

  it("has no start for all time", () => {
    expect(windowStart("all", new Date())).toBeNull();
  });
});
