import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type DeletedTakes, deleteTakesInTx } from "@/db/data/deletion";
import { take } from "@/db/schema";
import { runTx } from "@/db/tx";
import type { Executor } from "@/db/types";
import { type Result, err, ok } from "@/lib/result";
import { cancelRuns, requestStorageDrain } from "@/lib/trigger-runs";

/** Side effects run after a deletion commits; injectable for tests. */
export type AfterDelete = {
  readonly cancelRuns: (runIds: readonly string[]) => Promise<unknown>;
  readonly requestStorageDrain: () => Promise<unknown>;
};

const defaultAfterDelete: AfterDelete = { cancelRuns, requestStorageDrain };

/** Runs a post commit side effect; a failure is logged (take ID only) and never thrown. */
async function bestEffort(step: string, takeId: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    console.error("take delete: after commit step failed", {
      takeId,
      step,
      reason: error instanceof Error ? error.name : "unknown",
    });
  }
}

/**
 * `deleteTake` (AC-17): deletes the creator's take and everything under it (jobs, steps, cuts,
 * renders cascade), queuing every file key in the same transaction. After commit it cancels
 * the take's active Trigger.dev runs and asks for a queue drain, both best effort: a failure is
 * logged and the delete still succeeds (spec 0013 AC-3).
 */
export async function deleteTake(
  db: Executor,
  creatorId: string,
  takeId: string,
  after: AfterDelete = defaultAfterDelete,
): Promise<Result<DeletedTakes, "not_found">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");

  const result = await runTx(db, async (tx) => {
    const [owned] = await tx
      .select({ id: take.id })
      .from(take)
      .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)))
      .for("update");
    if (!owned) return err("not_found");
    return ok(await deleteTakesInTx(tx, [takeId]));
  });

  if (result.ok) {
    // The take is already gone: a failure here must not turn the delete into an error. The
    // storage drain is retried by the cleanup sweep, and a run that is not cancelled ends
    // quietly because its take is gone. IDs only in the log.
    await bestEffort("cancel runs", takeId, () => after.cancelRuns(result.data.runIds));
    await bestEffort("request drain", takeId, () => after.requestStorageDrain());
  }
  return result;
}
