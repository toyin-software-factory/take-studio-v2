import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cut, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { addManual, listForTake, reanalyse, setApplied } from ".";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

/** A creator with a probed 10 second take. */
async function setup() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  return { creatorId: creator.id, takeId: t.id };
}

async function addOk(creatorId: string, takeId: string, startMs: number, endMs: number) {
  const result = await addManual(db, { creatorId, takeId, startMs, endMs });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe("cuts.addManual (AC-8)", () => {
  it("adds an applied creator cut, stamped as creator changed", async () => {
    const { creatorId, takeId } = await setup();
    const created = await addManual(db, {
      creatorId,
      takeId,
      startMs: 1000,
      endMs: 2000,
      reason: " cough ",
    });
    expect(created.ok && created.data).toMatchObject({
      kind: "manual",
      proposedBy: "creator",
      applied: true,
      reason: "cough",
    });
    expect(created.ok && created.data.creatorChangedAt).toBeInstanceOf(Date);
  });

  it("rejects out of range cuts as invalid", async () => {
    const { creatorId, takeId } = await setup();
    for (const [startMs, endMs] of [
      [-1, 100],
      [500, 500],
      [600, 500],
      [9_000, 10_001],
    ]) {
      expect(await addManual(db, { creatorId, takeId, startMs, endMs })).toEqual({
        ok: false,
        error: "invalid",
      });
    }
  });

  it("rejects a cut overlapping any other cut (applied or not), but allows touching ones", async () => {
    const { creatorId, takeId } = await setup();
    const first = await addOk(creatorId, takeId, 1000, 2000);
    await setApplied(db, { creatorId, cutId: first.id, applied: false });

    expect(await addManual(db, { creatorId, takeId, startMs: 1500, endMs: 2500 })).toEqual({
      ok: false,
      error: "overlap",
    });
    expect((await addManual(db, { creatorId, takeId, startMs: 2000, endMs: 2500 })).ok).toBe(true);
  });

  it("lets only one of two simultaneous overlapping adds through", async () => {
    const { creatorId, takeId } = await setup();
    const results = await Promise.all([
      addManual(db, { creatorId, takeId, startMs: 3000, endMs: 4000 }),
      addManual(db, { creatorId, takeId, startMs: 3500, endMs: 4500 }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "overlap" }]);
  });

  it("refuses edits on an expired take", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "expired", durationMs: 10_000 });
    expect(
      await addManual(db, { creatorId: creator.id, takeId: t.id, startMs: 0, endMs: 10 }),
    ).toEqual({ ok: false, error: "invalid" });
  });
});

describe("cuts.setApplied and listForTake", () => {
  it("undoes a cut and records the creator's change", async () => {
    const { creatorId, takeId } = await setup();
    await reanalyse(db, {
      takeId,
      proposed: [{ startMs: 0, endMs: 500, kind: "pause", proposedBy: "rules" }],
    });
    const [rulesCut] = await db.select().from(cut).where(eq(cut.takeId, takeId));
    expect(rulesCut?.creatorChangedAt).toBeNull();

    const now = new Date("2026-11-11T12:00:00Z");
    const undone = await setApplied(db, {
      creatorId,
      cutId: rulesCut?.id ?? "",
      applied: false,
      now,
    });
    expect(undone.ok && undone.data).toMatchObject({ applied: false, creatorChangedAt: now });

    const list = await listForTake(db, creatorId, takeId);
    expect(list.ok && list.data.map((c) => c.applied)).toEqual([false]);
  });
});

describe("cuts.reanalyse (AC-9)", () => {
  it("keeps creator changed and manual cuts, replaces untouched ones, drops overlapping proposals", async () => {
    const { creatorId, takeId } = await setup();
    const first = await reanalyse(db, {
      takeId,
      proposed: [
        { startMs: 0, endMs: 500, kind: "pause", proposedBy: "rules" },
        { startMs: 1000, endMs: 1500, kind: "filler", proposedBy: "rules" },
        { startMs: 2000, endMs: 2500, kind: "false_start", proposedBy: "ai" },
      ],
    });
    if (!first.ok) throw new Error(first.error);
    const [untouched, changed] = first.data.cuts;
    await setApplied(db, { creatorId, cutId: changed?.id ?? "", applied: false });
    const manual = await addOk(creatorId, takeId, 5000, 6000);

    const second = await reanalyse(db, {
      takeId,
      proposed: [
        { startMs: 100, endMs: 400, kind: "pause", proposedBy: "ai" },
        { startMs: 1200, endMs: 1300, kind: "pause", proposedBy: "ai" }, // overlaps the changed cut
        { startMs: 5500, endMs: 7000, kind: "pause", proposedBy: "ai" }, // overlaps the manual cut
        { startMs: 8000, endMs: 8500, kind: "pause", proposedBy: "ai" },
      ],
    });
    if (!second.ok) throw new Error(second.error);

    const cuts = second.data.cuts;
    expect(second.data.dropped).toBe(2);
    expect(cuts.map((c) => [c.startMs, c.endMs, c.proposedBy, c.applied])).toEqual([
      [100, 400, "ai", true],
      [1000, 1500, "rules", false],
      [5000, 6000, "creator", true],
      [8000, 8500, "ai", true],
    ]);
    expect(cuts.some((c) => c.id === untouched?.id)).toBe(false);
    expect(cuts.find((c) => c.id === changed?.id)?.applied).toBe(false);
    expect(cuts.some((c) => c.id === manual.id)).toBe(true);
  });

  it("returns not_found for a missing take and invalid for bad proposals", async () => {
    expect(await reanalyse(db, { takeId: crypto.randomUUID(), proposed: [] })).toEqual({
      ok: false,
      error: "not_found",
    });
    const { takeId } = await setup();
    expect(
      await reanalyse(db, {
        takeId,
        proposed: [{ startMs: 0, endMs: 10, kind: "manual" as "pause", proposedBy: "ai" }],
      }),
    ).toEqual({ ok: false, error: "invalid" });
  });
});

/**
 * Polls Postgres until some session waits on a lock while running a `take ... FOR UPDATE`
 * query, i.e. the re analysis is blocked on the take row. False after `timeoutMs`.
 */
async function waitForTakeLockWait(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query ilike '%from "take"%for update%'`,
    );
    if ((row?.waiting ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe("creator edits racing a re analysis (AC-9)", () => {
  it("keeps the cut when the creator's edit lands before the re analysis", async () => {
    const { creatorId, takeId } = await setup();
    const first = await reanalyse(db, {
      takeId,
      proposed: [{ startMs: 0, endMs: 500, kind: "pause", proposedBy: "rules" }],
    });
    if (!first.ok) throw new Error(first.error);
    const cutId = first.data.cuts[0]?.id ?? "";

    expect((await setApplied(db, { creatorId, cutId, applied: false })).ok).toBe(true);
    await reanalyse(db, { takeId, proposed: [] });

    const [row] = await db.select().from(cut).where(eq(cut.id, cutId));
    expect(row).toMatchObject({ applied: false });
  });

  it("reports not_found when the re analysis replaced the cut before the creator's edit", async () => {
    const { creatorId, takeId } = await setup();
    const first = await reanalyse(db, {
      takeId,
      proposed: [{ startMs: 0, endMs: 500, kind: "pause", proposedBy: "rules" }],
    });
    if (!first.ok) throw new Error(first.error);
    const cutId = first.data.cuts[0]?.id ?? "";

    await reanalyse(db, { takeId, proposed: [] });
    expect(await setApplied(db, { creatorId, cutId, applied: false })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("makes a re analysis wait for a creator edit holding the take lock, then keep the cut", async () => {
    const { takeId } = await setup();
    const first = await reanalyse(db, {
      takeId,
      proposed: [{ startMs: 0, endMs: 500, kind: "pause", proposedBy: "rules" }],
    });
    if (!first.ok) throw new Error(first.error);
    const cutId = first.data.cuts[0]?.id ?? "";

    let reanalysis: ReturnType<typeof reanalyse> | undefined;
    let settled = false;
    await db.transaction(async (tx) => {
      // What setApplied does: lock the take row, then touch the cut.
      await tx.select({ id: take.id }).from(take).where(eq(take.id, takeId)).for("update");
      await tx
        .update(cut)
        .set({ applied: false, creatorChangedAt: new Date() })
        .where(eq(cut.id, cutId));

      reanalysis = reanalyse(db, { takeId, proposed: [] });
      void reanalysis.then(() => (settled = true));
      // Wait (up to 5 s) until Postgres shows the re analysis blocked on the take row lock.
      expect(await waitForTakeLockWait(5_000)).toBe(true);
      // Still blocked on the take lock while the edit is uncommitted.
      expect(settled).toBe(false);
    });

    const result = await reanalysis;
    expect(result?.ok).toBe(true);
    const [row] = await db.select().from(cut).where(eq(cut.id, cutId));
    expect(row).toMatchObject({ applied: false });
  });

  it("never deletes a cut the creator touched: either the change survives or it reports not_found", async () => {
    for (let round = 0; round < 5; round++) {
      const { creatorId, takeId } = await setup();
      const first = await reanalyse(db, {
        takeId,
        proposed: [{ startMs: 0, endMs: 500, kind: "pause", proposedBy: "rules" }],
      });
      if (!first.ok) throw new Error(first.error);
      const cutId = first.data.cuts[0]?.id ?? "";

      const [edit] = await Promise.all([
        setApplied(db, { creatorId, cutId, applied: false }),
        reanalyse(db, {
          takeId,
          proposed: [{ startMs: 1000, endMs: 1500, kind: "pause", proposedBy: "ai" }],
        }),
      ]);

      const [row] = await db.select().from(cut).where(eq(cut.id, cutId));
      if (edit.ok) {
        // The edit committed first, so the re analysis had to keep the touched cut.
        expect(row).toMatchObject({ applied: false });
        expect(row?.creatorChangedAt).toBeInstanceOf(Date);
      } else {
        // The re analysis replaced the untouched cut first; the edit saw it gone.
        expect(edit).toEqual({ ok: false, error: "not_found" });
        expect(row).toBeUndefined();
      }
    }
  });
});

describe("ownership (AC-2)", () => {
  it("gives creator B not_found on creator A's cuts", async () => {
    const a = await setup();
    const b = await createCreator(db);
    const own = await addOk(a.creatorId, a.takeId, 0, 100);

    expect(await listForTake(db, b.id, a.takeId)).toEqual({ ok: false, error: "not_found" });
    expect(await setApplied(db, { creatorId: b.id, cutId: own.id, applied: false })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await addManual(db, { creatorId: b.id, takeId: a.takeId, startMs: 200, endMs: 300 }),
    ).toEqual({ ok: false, error: "not_found" });

    const [row] = await db.select().from(cut).where(eq(cut.id, own.id));
    expect(row?.applied).toBe(true);
  });
});
