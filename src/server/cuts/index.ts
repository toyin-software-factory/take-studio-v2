import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Cut, reanalyse } from "@/db/data/cuts";
import { cut, take } from "@/db/schema";
import { runTx } from "@/db/tx";
import type { Executor } from "@/db/types";
import { cleanReason, isWithinTake, overlapsAny } from "@/lib/cut-rules";
import { type Result, err, ok } from "@/lib/result";

/**
 * Creator scoped cut functions (spec 0002, AC-2, AC-8). Ownership goes through
 * `take.creator_id`; another creator's take or cut is `not_found`. Cuts of an `expired` take
 * are read only (`invalid`). The system `reanalyse` is re exported for one `cuts` surface.
 */
export { reanalyse };
export type { Cut };

/** `cuts.listForTake`: the take's cuts in start order. */
export async function listForTake(
  db: Executor,
  creatorId: string,
  takeId: string,
): Promise<Result<readonly Cut[], "not_found">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");
  const [owned] = await db
    .select({ id: take.id })
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  if (!owned) return err("not_found");

  return ok(await db.select().from(cut).where(eq(cut.takeId, takeId)).orderBy(asc(cut.startMs)));
}

/**
 * `cuts.setApplied`: the creator applies or undoes a cut. Stamps `creator_changed_at`, so
 * re analysis keeps this cut as the creator left it (AC-9). Locks the take row like
 * `reanalyse` does, so a concurrent re analysis can't delete a cut the creator just touched.
 */
export async function setApplied(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly cutId: string;
    readonly applied: boolean;
    readonly now?: Date;
  },
): Promise<Result<Cut, "not_found" | "invalid">> {
  if (!z.uuid().safeParse(input.cutId).success) return err("not_found");

  return runTx(db, async (tx) => {
    const [row] = await tx
      .select({ status: take.status })
      .from(cut)
      .innerJoin(take, eq(take.id, cut.takeId))
      .where(and(eq(cut.id, input.cutId), eq(take.creatorId, input.creatorId)))
      .for("update", { of: take });
    if (!row) return err("not_found");
    if (row.status === "expired") return err("invalid");

    const [updated] = await tx
      .update(cut)
      .set({ applied: input.applied, creatorChangedAt: input.now ?? new Date() })
      .where(eq(cut.id, input.cutId))
      .returning();
    // Gone means a re analysis replaced it between our read and the lock.
    return updated ? ok(updated) : err("not_found");
  });
}

const manualSchema = z.object({
  startMs: z.number().int(),
  endMs: z.number().int(),
  reason: z.string().nullable().optional(),
});

/**
 * `cuts.addManual` (AC-8): the creator adds a cut. It must lie within the take
 * (`0 ≤ start < end ≤ length`, else `invalid`) and not overlap any other cut of the take,
 * applied or not (`overlap`). The take row is locked so two adds can't both pass the check.
 */
export async function addManual(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly reason?: string | null;
    readonly now?: Date;
  },
): Promise<Result<Cut, "not_found" | "invalid" | "overlap">> {
  if (!z.uuid().safeParse(input.takeId).success) return err("not_found");
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) return err("invalid");
  const range = { startMs: parsed.data.startMs, endMs: parsed.data.endMs };

  return runTx(db, async (tx) => {
    const [locked] = await tx
      .select({ status: take.status, durationMs: take.durationMs })
      .from(take)
      .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)))
      .for("update");
    if (!locked) return err("not_found");
    if (locked.status === "expired" || locked.durationMs === null) return err("invalid");
    if (!isWithinTake(range, locked.durationMs)) return err("invalid");

    const others = await tx
      .select({ startMs: cut.startMs, endMs: cut.endMs })
      .from(cut)
      .where(eq(cut.takeId, input.takeId));
    if (overlapsAny(range, others)) return err("overlap");

    const now = input.now ?? new Date();
    const [created] = await tx
      .insert(cut)
      .values({
        id: crypto.randomUUID(),
        takeId: input.takeId,
        ...range,
        kind: "manual",
        proposedBy: "creator",
        reason: cleanReason(parsed.data.reason),
        applied: true,
        creatorChangedAt: now,
      })
      .returning();
    return created ? ok(created) : err("invalid");
  });
}
