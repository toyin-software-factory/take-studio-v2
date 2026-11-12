import { dispatchJob } from "@/db/data/dispatch";
import { type BackgroundStartError, startBackgroundJob } from "@/db/data/jobs";
import type { Executor } from "@/db/types";
import { type Result, err, ok } from "@/lib/result";

export type ChangeBackgroundError =
  Exclude<BackgroundStartError, "invalid_transition"> | "not_ready" | "dispatch_failed";

/**
 * Change a take's background (spec 0008, AC-5, AC-6): the creator's own take only (another
 * creator's take, or a background that is not theirs and not built in, is `not_found`), then
 * `startBackgroundJob` (0 seconds charged, the take stays Ready) and the dispatch of
 * `process-take`. A trigger that throws finishes the job `trigger_failed` at once (inside
 * `dispatchJob`), so it never sits queued and the take keeps its current video and background.
 */
export async function changeBackground(
  db: Executor,
  creatorId: string,
  takeId: string,
  backgroundId: string | null,
  trigger: (jobId: string) => Promise<{ readonly id: string }>,
  now: Date = new Date(),
): Promise<Result<{ readonly jobId: string }, ChangeBackgroundError>> {
  const started = await startBackgroundJob(db, { creatorId, takeId, backgroundId, now });
  if (!started.ok) {
    return err(started.error === "invalid_transition" ? "not_ready" : started.error);
  }
  const dispatched = await dispatchJob(db, { jobId: started.data.id, trigger });
  if (!dispatched.ok) return err("dispatch_failed");
  return ok({ jobId: started.data.id });
}
