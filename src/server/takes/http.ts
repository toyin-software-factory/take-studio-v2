import { takeRenameSchema } from "@/lib/api-schemas/requests";
import { z } from "zod";
import { type ApiAuthDeps, guard as authGuard } from "../api-auth";
import { dispatchJob } from "@/db/data/dispatch";
import type { Db } from "@/db/types";
import { removedRanges } from "@/lib/cut-rules";
import { isExpired, isRetryable, removedMs, takeNote } from "@/lib/take-media";
import { limitExceededMessage } from "@/lib/usage-rules";
import { type AfterDelete, deleteTake, getForCreator, listForCreator, rename } from ".";
import { listForTake } from "../cuts";
import { recordEvent } from "../analytics/record";
import { hasActiveTranscribe } from "../transcripts";
import { start } from "../jobs";
import { PRIVATE_NO_STORE, usageForCreator, usageNumbers } from "../usage";
import { cardView, cutView, jobView, renderView, takeView } from "./views";

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

const STATUS: Readonly<Record<TakeError, number>> = {
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

const MESSAGES: Readonly<Record<TakeError, string>> = {
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

const LIST_PAGE_SIZE = 24;

/** GET /api/takes?cursor=…: the creator's takes as cards, newest first, 24 per page. */
export async function handleList(request: Request, deps: TakeHttpDeps): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const cursor = new URL(request.url).searchParams.get("cursor");
  const page = await listForCreator(creator.db, creator.creatorId, {
    cursor,
    limit: LIST_PAGE_SIZE,
  });
  if (!page.ok) return errorResponse("invalid_cursor");
  const now = deps.now?.() ?? new Date();
  return json({
    takes: page.data.rows.map((row) => cardView(row, now)),
    nextCursor: page.data.nextCursor,
  });
}

/** GET /api/takes/{id}: the take, its latest job with steps, latest render, removedMs, note. */
export async function handleGet(
  request: Request,
  takeId: string,
  deps: TakeHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const found = await getForCreator(creator.db, creator.creatorId, takeId);
  if (!found.ok) return errorResponse("not_found");
  const {
    take,
    latestJob,
    latestRender,
    background,
    noGreenScreen,
    aiEdit,
    suggestion,
    backgroundJob,
  } = found.data;

  // The latest render's snapshot, or else the applied cuts (spec 0004, value sourcing).
  const cutsResult = await listForTake(creator.db, creator.creatorId, take.id);
  const cuts = cutsResult.ok ? cutsResult.data : [];
  const ranges = latestRender?.removedRanges ?? removedRanges(cuts);
  const now = deps.now?.() ?? new Date();

  return json({
    take: takeView(take, now),
    latestJob: latestJob ? jobView(latestJob) : null,
    latestRender: latestRender ? renderView(latestRender) : null,
    removedMs: removedMs(ranges),
    note: takeNote(latestJob, latestRender?.status === "succeeded"),
    // Spec 0008: the background of the finished video, the no green screen note, and the latest
    // background change (for the "Try again" message).
    background: background ? { ...background, keyed: true } : null,
    noGreenScreen,
    backgroundJob,
    // Spec 0012: how the AI edit ended (done, unavailable, or unknown for older takes).
    aiEdit,
    // Spec 0012 AC-5: the suggested built in background with its reason, or null.
    suggestion,
    // Spec 0011: every cut in time order (`applied` is what the current video has), and whether
    // the original can still be played and rendered from.
    cuts: cuts.map(cutView),
    originalAvailable: !isExpired(take, now),
  });
}

/** PATCH /api/takes/{id} { title }: rename (any status, including expired). */
export async function handleRename(
  request: Request,
  takeId: string,
  deps: TakeHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const parsed = takeRenameSchema.safeParse(await readBody(request));
  if (!parsed.success) return errorResponse("invalid");
  const renamed = await rename(creator.db, creator.creatorId, takeId, parsed.data.title);
  if (!renamed.ok) return errorResponse(renamed.error);
  return json({ take: takeView(renamed.data, deps.now?.() ?? new Date()) });
}

/**
 * DELETE /api/takes/{id}: deletes the creator's take with every file and record (spec 0013
 * AC-3). 204 and no body; a missing take, another creator's take and a malformed ID give the
 * same 404, so a repeat delete changes nothing.
 */
export async function handleDelete(
  request: Request,
  takeId: string,
  deps: TakeHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const deleted = await deleteTake(creator.db, creator.creatorId, takeId, deps.afterDelete);
  if (!deleted.ok) return errorResponse("not_found");
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/takes/{id}/retry: a new run for a probed take that failed for a reason other
 * than its media (AC-10, spec 0002), including one cancelled while running. Media failures
 * and takes already processing get 409. `jobs.start` decides the charge, so a retry is not
 * charged again while an earlier initial charge stands.
 */
export async function handleRetry(
  request: Request,
  takeId: string,
  deps: TakeHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const found = await getForCreator(creator.db, creator.creatorId, takeId);
  if (!found.ok) return errorResponse("not_found");
  const { take } = found.data;
  // One clock read per request (spec 0014): retryability, the charge and the usage numbers
  // all use the same instant, so a month boundary can't split them.
  const at = deps.now?.() ?? new Date();
  // Spec 0007: any job start waits for a running transcript, with its own message.
  if (await hasActiveTranscribe(creator.db, take.id)) return errorResponse("transcript_running");
  if (take.status === "processing") return errorResponse("job_in_progress");
  if (!isRetryable(take, at)) return errorResponse("not_retryable");

  // A missing USAGE_HASH_SECRET is a configuration problem: a friendly 503 before any job
  // starts (so nothing is charged), never a 500.
  let usageSecret: string;
  try {
    usageSecret = deps.usageSecret();
  } catch {
    return errorResponse("unavailable");
  }

  const started = await start(creator.db, {
    creatorId: creator.creatorId,
    takeId: take.id,
    usageSecret,
    now: at,
  });
  if (!started.ok) {
    if (started.error === "limit_exceeded") {
      // Spec 0016 AC-4: the first charge did not fit, after the upload was complete.
      await recordEvent(creator.db, {
        name: "limit_hit",
        creatorId: creator.creatorId,
        takeId: take.id,
        props: { place: "upload_complete" },
      });
      return limitExceededResponse(creator, take.videoExpiresAt, usageSecret, at);
    }
    return errorResponse(started.error === "invalid_transition" ? "not_retryable" : started.error);
  }
  const dispatched = await dispatchJob(creator.db, {
    jobId: started.data.id,
    trigger: deps.triggerProcessTake,
  });
  if (!dispatched.ok) return errorResponse("dispatch_failed");
  return json({ job: jobView(started.data) }, 202);
}

/**
 * A retry refused at the allowance (spec 0014 AC-6, AC-8): 403 with the dated message and the
 * four usage numbers, `private, no-store`. Nothing was charged. Falls back to the plain message
 * when the numbers can't be read.
 */
async function limitExceededResponse(
  creator: Creator,
  videoExpiresAt: Date | null,
  usageSecret: string,
  at: Date,
): Promise<Response> {
  const usage = await usageForCreator(creator.db, {
    creatorId: creator.creatorId,
    usageSecret,
    now: at,
  }).catch(() => null);
  if (!usage?.ok) return limitFallback();
  return Response.json(
    {
      error: "limit_exceeded",
      message: limitExceededMessage({ resetsOn: usage.data.resetsOn, videoExpiresAt }),
      ...usageNumbers(usage.data),
    },
    { status: STATUS.limit_exceeded, headers: PRIVATE_NO_STORE },
  );
}

/** The plain limit message, still `private, no-store` like every other limit_exceeded body. */
function limitFallback(): Response {
  return Response.json(
    { error: "limit_exceeded", message: MESSAGES.limit_exceeded },
    { status: STATUS.limit_exceeded, headers: PRIVATE_NO_STORE },
  );
}

/** The request's JSON body, or undefined when it isn't JSON (the schema then rejects it). */
export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
