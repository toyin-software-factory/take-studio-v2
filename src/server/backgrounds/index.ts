import type { ChangeStartError } from "@/db/data/jobs";
import type { Executor } from "@/db/types";
import { type Result, err, ok } from "@/lib/result";
import { startChanges } from "../changes";

/** The codes of the legacy `PUT /background`: `nothing_changed` is still `same_background`. */
export type ChangeBackgroundError =
  | Exclude<ChangeStartError, "invalid_transition" | "nothing_changed">
  | "same_background"
  | "not_ready"
  | "dispatch_failed";

/**
 * Change a take's background (spec 0008, AC-5, AC-6): the creator's own take only (another
 * creator's take, or a background that is not theirs and not built in, is `not_found`), then
 * `startChanges` with no cut changes and no `baseRenderId` (spec 0011: a thin wrapper kept one
 * release for tabs loaded before the deploy) and the dispatch of `process-take`.
 */
export async function changeBackground(
  db: Executor,
  creatorId: string,
  takeId: string,
  backgroundId: string | null,
  trigger: (jobId: string) => Promise<{ readonly id: string }>,
  now: Date = new Date(),
): Promise<Result<{ readonly jobId: string }, ChangeBackgroundError>> {
  const started = await startChanges(
    db,
    { creatorId, takeId, background: { id: backgroundId }, cuts: [], now },
    trigger,
  );
  if (!started.ok) {
    if (started.error === "invalid_transition") return err("not_ready");
    return err(started.error === "nothing_changed" ? "same_background" : started.error);
  }
  return ok({ jobId: started.data.jobId });
}
