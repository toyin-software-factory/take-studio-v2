import * as Sentry from "@sentry/node";
import type { AiCause } from "@/lib/ai-edit";

/**
 * One Sentry message when the AI edit fell back to the rules cuts (spec 0012, AC-7). IDs and
 * the cause code only: never a prompt, an answer, a reason or any text from the take. The flush
 * sends it before the task can end. Without a DSN Sentry is off and this does nothing.
 */
export async function reportAiUnavailable(input: {
  readonly takeId: string;
  readonly jobId: string;
  readonly cause: AiCause;
}): Promise<void> {
  Sentry.captureMessage("ai_edit_unavailable", {
    level: "warning",
    tags: { takeId: input.takeId, jobId: input.jobId, cause: input.cause },
  });
  await Sentry.flush(2000).catch(() => false);
}
