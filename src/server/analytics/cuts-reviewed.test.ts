import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { analyticsEvent, cut } from "@/db/schema";
import { createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import { AI_EDIT } from "@/lib/ai-edit";
import { cutsReviewedProps } from "@/lib/analytics-events";
import { recordCutsReviewed } from "./cuts-reviewed";
import { cutQuality } from "./report";

// Its own database: cutQuality counts across all creators.
const test = await openTestDb({ database: "take_studio_test_analytics_cuts" });
const { db } = test;

afterAll(async () => {
  await test.close();
});

type Seed = {
  kind: string;
  proposedBy: string;
  reason?: string | null;
  applied?: boolean;
  touched?: boolean;
};
let cursor = 0;
async function seedCuts(takeId: string, seeds: readonly Seed[]) {
  for (const s of seeds) {
    const startMs = cursor;
    cursor += 2000;
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId,
      startMs,
      endMs: startMs + 500,
      kind: s.kind,
      proposedBy: s.proposedBy,
      reason: s.reason ?? null,
      applied: s.applied ?? true,
      creatorChangedAt: s.touched ? new Date() : null,
    });
  }
}
const snapshots = (takeId: string) =>
  db
    .select()
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.takeId, takeId), eq(analyticsEvent.name, "cuts_reviewed")));

describe("cuts_reviewed snapshot (spec 0017, AC-1, AC-5, AC-6)", () => {
  it("counts proposed, undone, restored and added, and repeat downloads count one take", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id);
    await seedCuts(t.id, [
      { kind: "filler", proposedBy: "ai" },
      { kind: "filler", proposedBy: "ai" },
      { kind: "filler", proposedBy: "ai", applied: false, touched: true },
      { kind: "pause", proposedBy: "ai" },
      {
        kind: "pause",
        proposedBy: "ai",
        reason: AI_EDIT.keptPauseReason,
        applied: true,
        touched: true,
      },
      { kind: "manual", proposedBy: "creator" },
    ]);
    const before = await cutQuality(db, "all", new Date());
    await recordCutsReviewed(db, c.id, t.id);
    await recordCutsReviewed(db, c.id, t.id);

    const rows = await snapshots(t.id);
    expect(rows).toHaveLength(2);
    const props = cutsReviewedProps.parse(rows[0]?.props);
    expect(props.counts.ai.filler).toEqual({
      proposed: 3,
      undone: 1,
      restored: 0,
      kept: 0,
      added: 0,
    });
    expect(props.counts.ai.pause).toEqual({
      proposed: 2,
      undone: 0,
      restored: 1,
      kept: 1,
      added: 0,
    });
    expect(props.counts.creator.manual.added).toBe(1);

    const quality = await cutQuality(db, "all", new Date());
    const tallyOf = (q: typeof quality) =>
      q.rows.find((r) => r.proposer === "ai" && r.kind === "filler")?.tally.proposed ?? 0;
    // Two snapshots of one take count once: 3 proposed fillers, not 6.
    expect(tallyOf(quality) - tallyOf(before)).toBe(3);
    expect(quality.reviewedTakes - before.reviewedTakes).toBe(1);
    const mine = await snapshots(t.id);
    expect(mine).toHaveLength(2);
  });

  it("stores numbers only, no words or ids", async () => {
    const c = await createCreator(db);
    const t = await seedTake(db, c.id);
    await seedCuts(t.id, [{ kind: "filler", proposedBy: "ai", reason: "said um to the client" }]);
    await recordCutsReviewed(db, c.id, t.id);
    const [row] = await snapshots(t.id);
    expect(JSON.stringify(row?.props)).not.toMatch(/um|client|[a-f0-9]{8}-/);
  });

  it("a failed insert never throws and logs only the name and take id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await createCreator(db);
    const t = await seedTake(db, c.id);
    const broken = {
      ...db,
      select: () => {
        throw new Error("secret transcript words");
      },
    };
    await expect(
      recordCutsReviewed(broken as unknown as typeof db, c.id, t.id),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith("analytics event failed", {
      name: "cuts_reviewed",
      takeId: t.id,
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
    expect(await snapshots(t.id)).toHaveLength(0);
  });
});
