/** Cleanup of a pipeline run, through the real deletion path (spec 0008 AC-10). */
import { eq, inArray } from "drizzle-orm";
import { drainDeletions, takeFileKeys } from "../../src/db/data/deletion";
import * as schema from "../../src/db/schema";
import { deleteCreatorData } from "../../src/server/account";
import { check } from "./checks";
import { db, r2 } from "./harness";
import { createdCreatorIds } from "./creator";

/** Delete what this run made. Never throws: a failure is recorded as a check. */
export async function cleanupRun(): Promise<void> {
  // Only the creators this run made; leftovers of abandoned runs are not touched here.
  try {
    const creators = [...createdCreatorIds];
    const owned = creators.length
      ? await db
          .select({ id: schema.take.id })
          .from(schema.take)
          .where(inArray(schema.take.creatorId, creators))
      : [];
    const takeKeys = await takeFileKeys(
      db,
      owned.map((t) => t.id),
    );
    // Spec 0008, AC-10: deleting an account also deletes the backgrounds it uploaded and their
    // files (every key of every row, accepted, refused or half uploaded).
    const uploads = creators.length
      ? await db
          .select()
          .from(schema.background)
          .where(inArray(schema.background.creatorId, creators))
      : [];
    const keys = [
      ...takeKeys,
      ...uploads.flatMap((row) =>
        [row.sourceKey, row.imageKey, row.thumbKey].filter((k): k is string => !!k),
      ),
    ];
    for (const id of creators) {
      await deleteCreatorData(db, id, {
        cancelRuns: async () => {},
        requestStorageDrain: async () => {},
      });
      await db.delete(schema.user).where(eq(schema.user.id, id));
    }
    const drained = await drainDeletions(db, (k) => r2.deleteObject(k));
    const left = (await Promise.all(keys.map((k) => r2.headObject(k)))).filter(Boolean).length;
    check("cleanup", "all test files deleted from R2", left === 0, {
      keys: keys.length,
      drained: drained.deleted,
      left,
    });
  } catch (error) {
    check("cleanup", "run", false, String(error));
  }
}
