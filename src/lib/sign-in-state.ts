/**
 * What the sign in form shows after a failed "Email me a sign in link" request (spec 0006,
 * AC-4, AC-8). Maps the Better Auth error to a state and a friendly message that says what
 * happened and what to do next (design.md Voice). No raw codes reach the creator.
 */

export type SignInFailure = "rate_limited" | "send_failed" | "error";

type AuthError = { readonly status?: number; readonly code?: string } | null | undefined;

export function signInFailureFrom(error: AuthError): SignInFailure {
  if (error?.status === 429 || error?.code === "EMAIL_RATE_LIMITED") return "rate_limited";
  if (error?.status === 503 || error?.code === "EMAIL_SEND_FAILED") return "send_failed";
  return "error";
}

export const SIGN_IN_MESSAGES: Record<SignInFailure, { title: string; text: string }> = {
  rate_limited: {
    title: "Too many sign in links",
    text: "You asked for a few links in a short time. Wait a few minutes and try again, or continue with Google.",
  },
  send_failed: {
    title: "We couldn't send the email",
    text: "Please try again or use Google.",
  },
  error: {
    title: "Something went wrong",
    text: "Please try again, or continue with Google.",
  },
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for an address worth sending a link to (one @, a dot in the domain, no spaces). */
export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}
