import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { sentryCheckAllowed } from "@/lib/sentry-check";

/**
 * Production check for job error reporting (spec 0005, AC-3). A task that fails before its
 * `run` (a bad payload, TASK_INPUT_ERROR) never reaches `tasks.onFailure`, so this one throws
 * inside `run`. It does that only when the payload token equals the SENTRY_CHECK_TOKEN of the
 * Trigger.dev environment (constant time compare); in every other case it does nothing: no
 * rendering, no storage, no database. The token is never logged or returned.
 */
const payloadSchema = z.object({ token: z.string().min(1) });

/** The check itself, apart from Trigger.dev: throws only for the right token. */
export async function runSentryCheck(
  payload: unknown,
  expected: string | undefined,
): Promise<{ readonly outcome: "skipped" }> {
  const parsed = payloadSchema.safeParse(payload);
  if (parsed.success && (await sentryCheckAllowed(parsed.data.token, expected))) {
    throw new Error("Sentry check: deliberate job error (spec 0005)");
  }
  return { outcome: "skipped" };
}

export const sentryCheckTask = task({
  id: "sentry-check",
  machine: "micro",
  maxDuration: 60,
  // One attempt: the failure reaches tasks.onFailure straight away.
  retry: { maxAttempts: 1 },
  run: (payload: unknown) => runSentryCheck(payload, process.env.SENTRY_CHECK_TOKEN),
});
