import { Resend } from "resend";
import { type Result, err, ok } from "@/lib/result";

/**
 * Sends email through Resend (spec 0006). The SDK returns `{ data, error }` instead of
 * throwing; this wrapper keeps that shape as our typed result and also catches a network
 * throw, so callers handle one thing. Logs and results carry no addresses, no content and no
 * keys: only a coarse reason.
 */

export type OutgoingEmail = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Resend idempotency key: the same key never sends twice (take emails: `take-email-{jobId}`). */
  readonly idempotencyKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export type SendError = "rate_limited" | "rejected" | "unavailable";

/** The part of the Resend client we use (also what tests fake). */
export type ResendLike = {
  readonly emails: {
    readonly send: (
      payload: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
        headers?: Record<string, string>;
      },
      options?: { idempotencyKey?: string },
    ) => Promise<{
      data: { id: string } | null;
      error: { name?: string; message?: string; statusCode?: number | null } | null;
    }>;
  };
};

export type EmailSender = (
  email: OutgoingEmail,
) => Promise<Result<{ readonly id: string }, SendError>>;

/** Maps a Resend error to a coarse reason: daily/rate limit, rejected input, or unavailable. */
export function sendErrorFrom(error: { name?: string; statusCode?: number | null }): SendError {
  if (error.statusCode === 429 || /rate_limit|daily_quota|monthly_quota/i.test(error.name ?? "")) {
    return "rate_limited";
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) return "rejected";
  return "unavailable";
}

export function createEmailSender(client: ResendLike, from: string): EmailSender {
  return async (email) => {
    try {
      const { data, error } = await client.emails.send(
        {
          from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.headers ? { headers: { ...email.headers } } : {}),
        },
        email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined,
      );
      if (error || !data) return err(error ? sendErrorFrom(error) : "unavailable");
      return ok({ id: data.id });
    } catch {
      return err("unavailable");
    }
  };
}

/** The real sender for the given key and `from` (`EMAIL_FROM`). */
export function resendSender(env: {
  readonly RESEND_API_KEY: string;
  readonly EMAIL_FROM: string;
}) {
  return createEmailSender(new Resend(env.RESEND_API_KEY) as unknown as ResendLike, env.EMAIL_FROM);
}
