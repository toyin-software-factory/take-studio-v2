import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type ProposedCut, cleanReason, planReanalysis } from "@/lib/cut-rules";
import { CUT_KINDS, CUT_PROPOSERS } from "@/lib/cuts";
import { type Result, err, ok } from "@/lib/result";
import { cut, take } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";

/** A stored cut. */
export type Cut = typeof cut.$inferSelect;

/**
 * System cut functions (spec 0002), safe for jobs: IDs only. Creator functions live in
 * src/server/cuts.
 */

const proposedSchema = z.object({
  startMs: z.number().int(),
  endMs: z.number().int(),
  kind: z.enum(CUT_KINDS).exclude(["manual"]),
  proposedBy: z.enum(CUT_PROPOSERS).exclude(["creator"]),
  reason: z.string().nullable().optional(),
});

/**
 * `cuts.reanalyse` (AC-9), one transaction: keeps every cut the creator changed or added,
 * deletes the untouched rules and AI cuts, and inserts the new proposals that fit (in range,
 * no overlap). Returns the take's cuts afterwards and how many proposals were dropped.
 */
export async function reanalyse(
  db: Executor,
  input: { readonly takeId: string; readonly proposed: readonly ProposedCut[] },
): Promise<
  Result<{ readonly cuts: readonly Cut[]; readonly dropped: number }, "not_found" | "invalid">
> {
  const parsed = z.array(proposedSchema).safeParse(input.proposed);
  if (!parsed.success) return err("invalid");

  return runTx(db, async (tx) => {
    // Lock the take so creator edits and re analysis don't interleave.
    const [locked] = await tx
      .select({ durationMs: take.durationMs })
      .from(take)
      .where(eq(take.id, input.takeId))
      .for("update");
    if (!locked) return err("not_found");
    if (locked.durationMs === null) return err("invalid");

    const existing = await tx.select().from(cut).where(eq(cut.takeId, input.takeId));
    const plan = planReanalysis(existing, parsed.data, locked.durationMs);

    if (plan.remove.length > 0) await tx.delete(cut).where(inArray(cut.id, plan.remove));
    if (plan.add.length > 0) {
      await tx.insert(cut).values(
        plan.add.map((proposal) => ({
          id: crypto.randomUUID(),
          takeId: input.takeId,
          startMs: proposal.startMs,
          endMs: proposal.endMs,
          kind: proposal.kind,
          proposedBy: proposal.proposedBy,
          reason: cleanReason(proposal.reason),
        })),
      );
    }

    const cuts = await tx
      .select()
      .from(cut)
      .where(eq(cut.takeId, input.takeId))
      .orderBy(asc(cut.startMs));
    return ok({ cuts, dropped: plan.dropped.length });
  });
}
