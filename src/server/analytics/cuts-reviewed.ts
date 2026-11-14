import { eq } from "drizzle-orm";
import { cut } from "@/db/schema";
import type { Executor } from "@/db/types";
import { AI_EDIT } from "@/lib/ai-edit";
import { countCuts } from "@/lib/cut-quality";
import { recordEvent } from "./record";

/**
 * Spec 0017 AC-1: when a download link is issued, snapshot how many cuts of each kind the
 * creator kept, undid or added. Counts only, computed from the take's `cut` rows at this moment.
 * Best effort like every analytics write: it never throws and logs only the event name and take
 * ID, so a failure here never changes the download answer. Repeat downloads write repeat rows;
 * /insights reads the latest one per take.
 */
export async function recordCutsReviewed(
  db: Executor,
  creatorId: string,
  takeId: string,
): Promise<void> {
  try {
    const rows = await db
      .select({
        kind: cut.kind,
        proposedBy: cut.proposedBy,
        reason: cut.reason,
        applied: cut.applied,
        creatorChangedAt: cut.creatorChangedAt,
      })
      .from(cut)
      .where(eq(cut.takeId, takeId));
    await recordEvent(db, {
      name: "cuts_reviewed",
      creatorId,
      takeId,
      props: { counts: countCuts(rows, AI_EDIT.keptPauseReason) },
    });
  } catch {
    console.error("analytics event failed", { name: "cuts_reviewed", takeId });
  }
}
