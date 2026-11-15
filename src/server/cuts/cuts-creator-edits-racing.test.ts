import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cut } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { addManual, listForTake, reanalyse, setApplied } from ".";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_cuts_creator_edits_racing" });
  db = testDb.db;
});
afterAll(() => testDb?.close()); /** A creator with a probed 10 second take. */
async function setup() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  return { creatorId: creator.id, takeId: t.id };
}
async function addOk(creatorId: string, takeId: string, startMs: number, endMs: number) {
  const result = await addManual(db, { creatorId, takeId, startMs, endMs });
  if (!result.ok) throw new Error(result.error);
  return result.data;
} /**
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
    const { creatorId, takeId } = await setup();
    const first = await reanalyse(db, {
      takeId,
      proposed: [{ startMs: 0, endMs: 500, kind: "pause", proposedBy: "rules" }],
    });
    if (!first.ok) throw new Error(first.error);
    const cutId = first.data.cuts[0]?.id ?? "";

    let reanalysis: ReturnType<typeof reanalyse> | undefined;
    let settled = false;
    await db.transaction(async (tx) => {
      // The real setApplied, inside the held transaction: it takes the take row lock.
      expect((await setApplied(tx, { creatorId, cutId, applied: false })).ok).toBe(true);

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
