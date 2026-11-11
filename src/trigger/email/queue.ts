import { logger } from "@trigger.dev/sdk";
import { notifyTakeTask } from "./notify-take";

/**
 * Queues the take email for a finished job. Never throws: the take is already final, and a
 * failed queue write only means no email (logged with the job ID, nothing else).
 */
export async function queueTakeEmail(jobId: string): Promise<void> {
  try {
    await notifyTakeTask.trigger({ jobId });
  } catch {
    logger.error("notify-take: could not queue the take email", { jobId });
  }
}
