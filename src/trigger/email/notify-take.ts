import { logger, task } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { resendSender } from "@/lib/email/send";
import { z } from "zod";
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
    // BETTER_AUTH_URL builds the take link and the turn off link; it must be set in the
    // Trigger.dev environment next to the email variables.
    const baseUrl = z.url().parse(process.env.BETTER_AUTH_URL);
    const env = { ...parseJobEnv(), ...parseEmailEnv() };
    const result = await withJobDb(env.DATABASE_URL, (db) =>
      notifyTakeFinished(db, payload.jobId, {
        sendEmail: resendSender(env),
        baseUrl,
        linkSecret: env.EMAIL_LINK_SECRET,
      }),
    );
    if (!result.ok) throw new Error(`take email not sent: ${result.error}`);
    logger.info("notify-take", { jobId: payload.jobId, outcome: result.data });
    return { jobId: payload.jobId, outcome: result.data };
  },
});
