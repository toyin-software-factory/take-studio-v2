import { apiMessage } from "./take-api";

/**
 * What the take page says when PUT /api/takes/{id}/background does not answer 202 (S3S-T13).
 * The server's own friendly message wins (409 job_active, same_background, no_green_screen, 429,
 * 503 ... all carry one); a status with no message body (a 401 or 403 from the guard, a gateway
 * error page, an unexpected status) gets a fixed wording here, so a refusal is never silent.
 */
export function backgroundStartMessage(status: number, data: unknown): string {
  const fallback =
    status === 401
      ? "You've been signed out. Sign in again to change the background."
      : status === 403
        ? "That change was blocked. Reload the page and try again."
        : status === 404
          ? "We couldn't find that take or background."
          : status === 409
            ? "A background change is already running. It'll show here when it's done."
            : status === 429
              ? "You've changed backgrounds a lot in the last hour. Please try again later."
              : "The change didn't start. Please try again.";
  return apiMessage(data, fallback);
}

/**
 * True when a refusal means the page is out of date (a change is running, or the take already
 * has that background, or it is no longer ready), so it should read the take again and show what
 * is really there.
 */
export function refusalMeansStalePage(status: number): boolean {
  return status === 409 || status === 404;
}

/** Seconds after which a thumbnail link is refreshed before it is used again (links last 1 hour). */
export const LINK_REFRESH_MS = 30 * 60_000;
