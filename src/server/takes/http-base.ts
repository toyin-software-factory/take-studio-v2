import { type ApiAuthDeps, guard as authGuard } from "../api-auth";
import type { Db } from "@/db/types";
import { type AfterDelete } from ".";

/**
 * HTTP handlers for the take routes (spec 0004 API surface, AC-10, AC-11): session required
 * (401 JSON), `Origin` checked on PATCH, POST and DELETE (403), bodies validated with zod, typed
 * errors mapped to status codes and friendly messages, `Cache-Control: no-store` always.
 * Another creator's take and a malformed ID give the same 404. Dependencies are passed in so
 * tests can drive the handlers against a real database.
 */

export type Creator = { readonly db: Db; readonly creatorId: string };

export type TakeHttpDeps = {
  /** The signed in creator for this request, or null. */
  readonly getCreator: (request: Request) => Promise<Creator | null>;
  /** The only origin allowed to change takes (the app's own). */
  readonly allowedOrigin: string;
  /** Lets a bearer key through the shared guard (spec 0018); tests leave it out. */
  readonly keyAuth?: ApiAuthDeps["keyAuth"];
  /** USAGE_HASH_SECRET, read only when a retry starts a job. */
  readonly usageSecret: () => string;
  /** Triggers `process-take` for a job (idempotent per job ID). */
  readonly triggerProcessTake: (jobId: string) => Promise<{ readonly id: string }>;
  readonly now?: () => Date;
  /** Post commit steps of a delete; tests pass fakes, routes use the real ones. */
  readonly afterDelete?: AfterDelete;
};

export type TakeError =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "invalid_cursor"
  | "job_in_progress"
  | "transcript_running"
  | "not_retryable"
  | "dispatch_failed"
  | "unavailable"
  | "expired"
  | "storage_error"
  /** Spec 0017: a "Missed something?" mark on a take that is not ready or has expired. */
  | "not_markable"
  /** Spec 0014: the monthly allowance is used up (the retry route sends the dated message). */
  | "limit_exceeded";

export const STATUS: Readonly<Record<TakeError, number>> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 422,
  invalid_cursor: 400,
  job_in_progress: 409,
  transcript_running: 409,
  not_retryable: 409,
  dispatch_failed: 503,
  unavailable: 503,
  expired: 410,
  storage_error: 503,
  not_markable: 409,
  limit_exceeded: 403,
};

export const MESSAGES: Readonly<Record<TakeError, string>> = {
  unauthorized: "Please sign in again.",
  forbidden: "This request isn't allowed.",
  not_found: "We couldn't find that take.",
  invalid: "Enter a title between 1 and 200 characters.",
  invalid_cursor: "That page of takes isn't available. Go back to your takes.",
  job_in_progress: "This take is already being processed.",
  transcript_running: "Your transcript is still being made. Try again in a moment.",
  not_retryable: "This take can't be tried again. Upload another video instead.",
  dispatch_failed: "Processing didn't start. Please try again.",
  unavailable: "Processing isn't available right now. Please try again later.",
  expired: "This video has expired. Videos are kept for 30 days.",
  storage_error: "Storage is having a problem right now. Please try again.",
  not_markable: "This video is no longer available, so we can't note that.",
  limit_exceeded: "This month's allowance is used up. Try again when it resets.",
};

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(code: TakeError): Response {
  return json({ error: code, message: MESSAGES[code] }, STATUS[code]);
}

/** The shared identity guard (bearer key, else session, Origin for session writes); a Response means stop. */
export async function guard(
  request: Request,
  deps: Pick<TakeHttpDeps, "getCreator" | "allowedOrigin" | "keyAuth">,
  options: { readonly checkOrigin: boolean },
): Promise<Creator | Response> {
  return authGuard(request, deps, options);
}

/** The request's JSON body, or undefined when it isn't JSON (the schema then rejects it). */
export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
