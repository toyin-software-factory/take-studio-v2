import { afterAll, describe, expect, it } from "vitest";
import { createCreator, openTestDb } from "@/db/testing/test-db";
import { recordEvent } from "./record";
import { funnel, windowStart } from "./report";

// Its own database: these tests count rows across all creators, so they must not share one
// with a file that creates signups at the same time (signup-hook.test.ts).
const test = await openTestDb({ database: "take_studio_test_analytics_funnel" });
const { db } = test;

afterAll(async () => {
  await test.close();
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
