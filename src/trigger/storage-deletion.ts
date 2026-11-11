import { logger, queue, task } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { drainDeletions } from "@/db/data/deletion";
import { parseJobEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";

/** One drain at a time; parallel drains would only contend for the same rows. */
const storageDeletionQueue = queue({ name: "storage-deletion", concurrencyLimit: 1 });

/**
 * Drains the `storage_deletion` queue (spec 0002, AC-17): deletes each queued R2 object and
 * removes its row. A failed delete is retried on a later drain (attempts and last_error on
 * the row); rows that keep failing are left for a person and counted in the output.
 * Triggered after deletions and at the end of every cleanup run. Logs counts only, never keys.
 */
export const storageDeletionTask = task({
  id: "storage-deletion",
  queue: storageDeletionQueue,
  machine: "small-1x",
  maxDuration: 600,
  run: async () => {
    const env = parseJobEnv();
    const r2 = createR2(env);
    const result = await withJobDb(env.DATABASE_URL, (db) =>
      drainDeletions(db, (key) => r2.deleteObject(key)),
    );
    if (result.stuck > 0) logger.warn("storage deletion rows need a look", { stuck: result.stuck });
    logger.info("storage deletion drained", result);
    return result;
  },
});
