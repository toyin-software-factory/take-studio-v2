import { and, desc, eq, isNull } from "drizzle-orm";
import { jobStep, processingJob, render, take, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { unsubscribeUrl } from "@/lib/email-links";
import { type Result, err, ok } from "@/lib/result";
import { failureMessage } from "@/lib/take-display";
import { isRetryable, removedMs, takeNote } from "@/lib/take-media";
import type { EmailSender } from "@/lib/email/send";
import { takeFailedEmail, takeReadyEmail } from "@/lib/email/templates";

/**
 * "Your take is ready" or "didn't finish" email for one finished job (spec 0006, AC-5, AC-6,
 * AC-8). Called after `jobs.finish` has committed, so the email always matches the final state.
 * At most one email per job: a job with `notified_at` set is skipped, and the Resend
 * idempotency key `take-email-{jobId}` covers two calls racing before `notified_at` is written.
 * Creators who turned emails off get none. Jobs that ended `cancelled` send nothing. Carries
 * IDs only in results and logs; the address and title only go to Resend.
 */

export type NotifyDeps = {
  readonly sendEmail: EmailSender;
  /** App base URL (BETTER_AUTH_URL), for the take link and the turn off link. */
  readonly baseUrl: string;
  /** EMAIL_LINK_SECRET, signs the turn off link. */
  readonly linkSecret: string;
};

export type NotifyOutcome = "sent" | "already_sent" | "emails_off" | "not_final" | "not_found";

export async function notifyTakeFinished(
  db: Executor,
  jobId: string,
  deps: NotifyDeps,
  now: Date = new Date(),
): Promise<Result<NotifyOutcome, "send_failed">> {
  const [found] = await db
    .select({ job: processingJob, take, user })
    .from(processingJob)
    .innerJoin(take, eq(take.id, processingJob.takeId))
    .innerJoin(user, eq(user.id, take.creatorId))
    .where(eq(processingJob.id, jobId));
  if (!found) return ok("not_found");
  const { job, take: t, user: creator } = found;

  if (job.notifiedAt) return ok("already_sent");
  if (job.status !== "succeeded" && job.status !== "failed") return ok("not_final");
  if (!creator.takeEmails) return ok("emails_off");

  const takeUrl = new URL(`/takes/${t.id}`, deps.baseUrl).toString();
  const turnOff = await unsubscribeUrl(deps.baseUrl, creator.id, deps.linkSecret);
  const links = { title: t.title, takeUrl, unsubscribeUrl: turnOff };

  let mail;
  if (job.status === "succeeded") {
    const [latest] = await db
      .select()
      .from(render)
      .where(and(eq(render.jobId, job.id), eq(render.isLatest, true)))
      .orderBy(desc(render.createdAt))
      .limit(1);
    const steps = await db.select().from(jobStep).where(eq(jobStep.jobId, job.id));
    mail = takeReadyEmail({
      ...links,
      removedMs: latest ? removedMs(latest.removedRanges) : 0,
      note: takeNote({ status: job.status, steps }, latest !== undefined),
    });
  } else {
    const retryable = isRetryable(
      {
        status: t.status,
        failureCode: t.failureCode,
        durationMs: t.durationMs,
        videoExpiresAt: t.videoExpiresAt,
      },
      now,
    );
    mail = takeFailedEmail({
      ...links,
      message: failureMessage(
        { failureCode: job.failureCode, durationMs: t.durationMs },
        retryable,
      ),
    });
  }

  const sent = await deps.sendEmail({
    to: creator.email,
    ...mail,
    idempotencyKey: `take-email-${job.id}`,
    // One click turn off, also for mail clients' own unsubscribe button (RFC 8058).
    headers: {
      "List-Unsubscribe": `<${turnOff}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (!sent.ok) return err("send_failed");

  await db
    .update(processingJob)
    .set({ notifiedAt: now })
    .where(and(eq(processingJob.id, job.id), isNull(processingJob.notifiedAt)));
  return ok("sent");
}
