import { eq } from "drizzle-orm";
import { deleteCreatorBackgrounds } from "@/db/data/backgrounds";
import { type DeletedTakes, deleteTakesInTx } from "@/db/data/deletion";
import { take } from "@/db/schema";
import type { Db } from "@/db/types";
import { cancelRuns, requestStorageDrain } from "@/lib/trigger-runs";
import type { AfterDelete } from "../takes";

/**
 * Account deletion (spec 0002, AC-17, "Security model"). Better Auth's `user.deleteUser` runs
 * `deleteCreatorData` in its `beforeDelete` hook (see ../auth.ts), then deletes the user row.
 *
 * In one transaction: delete the creator's uploaded backgrounds (queueing their files), lock all
 * the creator's takes, queue every file key, delete the takes (everything under them cascades). After commit: cancel their active runs and ask for a
 * queue drain, best effort. Usage accounting is keyed by an email HMAC, not the user, so
 * usage rows (slice 6) survive; the job rows holding charge hashes go with the takes.
 */
export async function deleteCreatorData(
  db: Db,
  creatorId: string,
  after: AfterDelete = { cancelRuns, requestStorageDrain },
): Promise<DeletedTakes> {
  let backgroundsDeleted = 0;
  const deleted = await db.transaction(async (tx) => {
    // Lock order: the creator's backgrounds (uploaded images, previews and all their files),
    // then the takes.
    backgroundsDeleted = await deleteCreatorBackgrounds(tx, creatorId);
    const owned = await tx
      .select({ id: take.id })
      .from(take)
      .where(eq(take.creatorId, creatorId))
      .for("update");
    return deleteTakesInTx(
      tx,
      owned.map(({ id }) => id),
    );
  });

  await after.cancelRuns(deleted.runIds);
  if (deleted.queuedKeys.length > 0 || backgroundsDeleted > 0) await after.requestStorageDrain();
  return deleted;
}

/** The Better Auth `beforeDelete` hook for this database. */
export function beforeDeleteUser(db: Db) {
  return async (user: { readonly id: string }): Promise<void> => {
    await deleteCreatorData(db, user.id);
  };
}
