import { logger } from "@trigger.dev/sdk";
import type { JobDb } from "@/db/client/job";
import { dispatchJob } from "@/db/data/dispatch";
import { startTranscribeJob } from "@/db/data/jobs";
import { triggerForTranscribe } from "@/lib/trigger-runs";

/**
 * After the video is Ready (spec 0007, Pipeline step 1): starts the take's transcribe job and
 * triggers `transcribe-take` (key `transcribe-{jobId}`; a throwing trigger finishes the job
 * `trigger_failed` at once, so it never sits queued). Never throws and never touches the
 * video job: a refused start (transcript exists, original gone) just leaves "Make transcript".
 */
export async function startTranscript(client: JobDb, takeId: string): Promise<void> {
  // A thrown start (the database blinked) is tried 3 times; a retry of this task would exit
  // early because the video job is already final. A refused start is final, not retried. If
  // all three throw, the take shows "Make transcript" (spec 0007, Pipeline step 1).
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const started = await startTranscribeJob(client, { takeId });
      if (!started.ok) {
        logger.info("process-take: transcript not started", { takeId, reason: started.error });
        return;
      }
      const dispatched = await dispatchJob(client, {
        jobId: started.data.id,
        trigger: triggerForTranscribe(),
      });
      if (!dispatched.ok) {
        logger.warn("process-take: transcript trigger failed", { takeId, jobId: started.data.id });
      }
      return;
    } catch {
      logger.warn("process-take: transcript start threw", { takeId, attempt });
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}
