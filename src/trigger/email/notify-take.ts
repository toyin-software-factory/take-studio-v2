import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { resendSender } from "@/lib/email/send";
import { parseEmailEnv, parseJobEnv } from "@/lib/env";
import { notifyTakeFinished } from "./notify";

/**
 * Sends the take ready or didn't finish email for one finished job (spec 0006, AC-5, AC-8).
 * Queued by `process-take` after `jobs.finish` has committed, so it never delays or fails the
 * take. Up to 3 attempts: a Resend failure throws so Trigger.dev retries; after the last one
 * the global `tasks.onFailure` hook reports to Sentry (task, run and job IDs only) and the
 * email is dropped. `notified_at` plus the Resend idempotency key make a retry or a second
 * run harmless.
 */
export const notifyTakeTask = task({
  id: "notify-take",
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 3 },
  run: async (payload: { readonly jobId: string }) => {
    // A missing or invalid variable is a deploy mistake, not a send failure: stop now with a
    // clear error (names only) instead of retrying.
    let env;
    try {
      env = { ...parseJobEnv(), ...parseEmailEnv() };
    } catch (error) {
      throw new AbortTaskRunError(error instanceof Error ? error.message : "Invalid email env");
    }
    const result = await withJobDb(env.DATABASE_URL, (db) =>
      notifyTakeFinished(db, payload.jobId, {
        sendEmail: resendSender(env),
        baseUrl: new URL(env.BETTER_AUTH_URL).origin,
        linkSecret: env.EMAIL_LINK_SECRET,
      }),
    );
    if (!result.ok) throw new Error(`take email not sent: ${result.error}`);
    logger.info("notify-take", { jobId: payload.jobId, outcome: result.data });
    return { jobId: payload.jobId, outcome: result.data };
  },
});
