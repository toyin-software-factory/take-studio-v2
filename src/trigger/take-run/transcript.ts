import { logger } from "@trigger.dev/sdk";
import type { JobDb } from "@/db/client/job";
import { dispatchJob } from "@/db/data/dispatch";
import { finish, startTranscribeJob } from "@/db/data/jobs";
import { triggerForTranscribe } from "@/lib/trigger-runs";

/**
 * After the video is Ready (spec 0007, Pipeline step 1): starts the take's transcribe job and
 * triggers `transcribe-take` (key `transcribe-{jobId}`; a throwing trigger finishes the job
 * `trigger_failed` at once, so it never sits queued). Never throws and never touches the
 * video job: a refused start (transcript exists, original gone) just leaves "Make transcript".
 */
export async function startTranscript(client: JobDb, takeId: string): Promise<void> {
  // A thrown call (the database blinked) is tried 3 times; a retry of this task would exit
  // early because the video job is already final. A refused start is final, not retried. Once
  // the job is started only the dispatch is retried (a second start would be refused as
  // `job_active`), and if it never goes through the job is failed, so no transcribe job is left
  // queued for the stale cleanup. If the start itself never goes through, there is no job and
  // the take shows "Make transcript" (spec 0007, Pipeline step 1).
  let jobId: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (!jobId) {
        const started = await startTranscribeJob(client, { takeId });
        if (!started.ok) {
          logger.info("process-take: transcript not started", { takeId, reason: started.error });
          return;
        }
        jobId = started.data.id;
      }
      const dispatched = await dispatchJob(client, { jobId, trigger: triggerForTranscribe() });
      if (!dispatched.ok) {
        logger.warn("process-take: transcript trigger failed", { takeId, jobId });
      }
      return;
    } catch {
      logger.warn("process-take: transcript start threw", { takeId, attempt });
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  if (jobId) await releaseTranscribeJob(client, takeId, jobId);
}

/** The dispatch never went through: fail the job (refundable `trigger_failed`), never throw. */
async function releaseTranscribeJob(client: JobDb, takeId: string, jobId: string): Promise<void> {
  try {
    await finish(client, { jobId, status: "failed", failureCode: "trigger_failed" });
  } catch {
    logger.error("process-take: transcript job not released", { takeId, jobId });
  }
}
