import { logger } from "@trigger.dev/sdk";
import { jobKindSendsEmail } from "@/lib/processing";
import { notifyTakeTask } from "./notify-take";

/**
 * Queues the take email for a finished job. Never throws: the take is already final, and a
 * failed queue write only means no email (logged with the job ID, nothing else). Jobs of a
 * kind that is never emailed (`transcribe`, spec 0007) queue nothing.
 */
export async function queueTakeEmail(jobId: string, kind: string): Promise<void> {
  if (!jobKindSendsEmail(kind)) return;
  try {
    await notifyTakeTask.trigger({ jobId });
  } catch {
    logger.error("notify-take: could not queue the take email", { jobId });
  }
}
