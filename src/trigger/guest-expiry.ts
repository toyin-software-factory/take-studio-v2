import { logger } from "@trigger.dev/sdk";
import {
  deleteExpiredGuestTakes,
  deleteExpiredGuests,
  purgeOldGuestCounts,
} from "@/db/data/guest-expiry";
import type { Executor } from "@/db/types";
import type { R2 } from "@/lib/r2";
import { cancelRuns } from "@/lib/trigger-runs";
import { recordJobEvent } from "./analytics/record";

/**
 * Spec 0023 step 7 (AC-9): the expired guest part of the cleanup sweep. It runs before the file
 * deletion drain, so the files it queues go in the same run. Each part logs and never throws, so a
 * failure here never stops the rest of the sweep. Logs counts and IDs only.
 */
export async function sweepExpiredGuests(
  db: Executor,
  r2: Pick<R2, "abortMultipartUpload">,
  now: Date,
): Promise<{
  readonly takes: number;
  readonly guests: number;
  readonly counts: number;
  readonly abortFailures: number;
}> {
  const fail = (what: string) => (error: unknown) => {
    logger.error(what, { error: error instanceof Error ? error.name : "unknown" });
    return null;
  };
  const expired =
    (await deleteExpiredGuestTakes(db, now).catch(fail("guest take sweep failed"))) ?? [];
  // First: the takes and their run IDs are already deleted, so a later sweep cannot find the runs.
  await cancelRuns(expired.flatMap((t) => t.runIds));
  let abortFailures = 0;
  for (const t of expired) {
    if (t.uploadId === null) continue;
    try {
      await r2.abortMultipartUpload(t.originalKey, t.uploadId);
    } catch {
      // The R2 lifecycle rule is the backstop for orphaned parts.
      abortFailures++;
      logger.warn("multipart abort failed", { takeId: t.takeId });
    }
  }
  // Spec 0023 AC-12: one event per deleted take, no creator, a flag and nothing else. The take is
  // gone, so there is no take ID either.
  for (const t of expired) {
    await recordJobEvent(db, {
      name: "guest_expired",
      creatorId: null,
      props: { hadEmail: t.hadEmail },
    });
  }
  const guests = (await deleteExpiredGuests(db, now).catch(fail("guest sweep failed"))) ?? 0;
  const counts = (await purgeOldGuestCounts(db, now).catch(fail("guest count purge failed"))) ?? 0;
  return { takes: expired.length, guests, counts, abortFailures };
}
