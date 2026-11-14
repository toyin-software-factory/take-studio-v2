import { afterAll, describe, expect, it } from "vitest";
import { createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import { recordEvent } from "./record";
import { foundingMembers, funnel, windowStart } from "./report";

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

describe("funnel counts (spec 0016, AC-7, AC-12)", () => {
  it("counts distinct creators, the second take, AI share, failures and founding members", async () => {
    const before = await funnel(db, "all");
    const foundingBefore = await foundingMembers(db);
    const a = await createCreator(db);
    const b = await createCreator(db);
    const ta = [await seedTake(db, a.id), await seedTake(db, a.id)];
    const tb = await seedTake(db, b.id);
    for (const t of ta)
      await recordEvent(db, { name: "take_uploaded", creatorId: a.id, takeId: t.id });
    await recordEvent(db, { name: "take_uploaded", creatorId: b.id, takeId: tb.id });
    await recordEvent(db, {
      name: "take_ready",
      creatorId: a.id,
      takeId: ta[0]!.id,
      props: { aiEdit: "done", cuts: 3 },
    });
    await recordEvent(db, {
      name: "take_ready",
      creatorId: b.id,
      takeId: tb.id,
      props: { aiEdit: "none", cuts: 0 },
    });
    for (const kind of ["video", "video", "transcript_txt"] as const) {
      await recordEvent(db, {
        name: "take_downloaded",
        creatorId: a.id,
        takeId: ta[0]!.id,
        props: { kind },
      });
    }
    await recordEvent(db, {
      name: "take_failed",
      creatorId: b.id,
      props: { code: "ffmpeg_error" },
    });
    const after = await funnel(db, "all");
    const foundingAfter = await foundingMembers(db);
    expect(after.uploaded - before.uploaded).toBe(2);
    expect(after.ready - before.ready).toBe(2);
    expect(after.downloaded - before.downloaded).toBe(1);
    expect(after.secondTake - before.secondTake).toBe(1);
    expect(foundingAfter - foundingBefore).toBe(1);
    expect(after.readyTakes - before.readyTakes).toBe(2);
    expect(after.readyWithAiEdit - before.readyWithAiEdit).toBe(1);
    const count = (f: typeof after) =>
      f.failures.find((x) => x.code === "ffmpeg_error")?.count ?? 0;
    expect(count(after) - count(before)).toBe(1);
  });
});
