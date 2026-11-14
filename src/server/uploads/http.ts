import { z } from "zod";
import type { Db } from "@/db/types";
import { shortDate } from "@/lib/usage-rules";
import { recordEvent } from "../analytics/record";
import { PRIVATE_NO_STORE, usageForCreator, usageNumbers } from "../usage";
import {
  type UploadDeps,
  type UploadError,
  abortUpload,
  completeUpload,
  createUpload,
  presignParts,
} from ".";

/**
 * HTTP handlers for the upload routes (spec 0004 API surface): session required (401 JSON),
 * `Origin` checked on POST and DELETE (403), JSON bodies validated, typed errors mapped to
 * status codes and friendly messages. Dependencies are passed in so tests can drive them.
 */

export type HttpDeps = {
  /** The signed in creator for this request, or null. */
  readonly getCreator: (
    request: Request,
  ) => Promise<{ readonly db: Db; readonly creatorId: string } | null>;
  /** The only origin allowed to call these routes (the app's own). */
  readonly allowedOrigin: string;
  readonly uploadDeps: (db: Db) => UploadDeps;
  /** USAGE_HASH_SECRET for the early allowance refusal (spec 0014 AC-7); left out or throwing skips it. */
  readonly usageSecret?: () => string;
  readonly now?: () => Date;
};

const STATUS: Readonly<Record<UploadError, number>> = {
  invalid: 422,
  script_too_long: 422,
  too_large: 422,
  rate_limited: 429,
  not_found: 404,
  not_uploading: 409,
  bad_parts: 422,
  size_mismatch: 422,
  storage_error: 503,
  dispatch_failed: 503,
  background_not_found: 404,
  background_not_ready: 409,
};

const MESSAGES: Readonly<Record<UploadError, string>> = {
  invalid: "That file can't be uploaded. Choose an MP4 or MOV video.",
  script_too_long: "Your script is over 20,000 characters. Shorten it and try again.",
  too_large: "This video is over 2 GB. The limit is 2 GB.",
  rate_limited: "You've started 10 uploads in the last hour. Try again a little later.",
  not_found: "We couldn't find that take.",
  not_uploading: "This upload has already finished or been cancelled.",
  bad_parts: "The upload didn't come through completely. Please try again.",
  size_mismatch: "The uploaded file doesn't match the file you chose. Please upload it again.",
  storage_error: "Storage is having a problem right now. Please try again.",
  dispatch_failed: "Your upload is safe, but processing didn't start. Please try again.",
  background_not_found: "We couldn't find that background. Choose another or keep the original.",
  background_not_ready:
    "That background isn't ready yet. Choose another, or keep the original and change it later.",
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function errorResponse(code: UploadError): Response {
  return json({ error: code, message: MESSAGES[code] }, STATUS[code]);
}

/** Session and Origin checks shared by every handler; a Response means stop. */
async function guard(
  request: Request,
  deps: HttpDeps,
): Promise<{ readonly db: Db; readonly creatorId: string } | Response> {
  if (request.headers.get("origin") !== deps.allowedOrigin) {
    return json({ error: "forbidden", message: "This request isn't allowed." }, 403);
  }
  const creator = await deps.getCreator(request);
  if (!creator) return json({ error: "unauthorized", message: "Please sign in again." }, 401);
  return creator;
}

/** The request's JSON body, or undefined when it isn't JSON (the schemas then reject it). */
async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const hintSchema = z.object({ durationHintMs: z.number().positive().finite().optional() });

/**
 * Early refusal (spec 0014 AC-7): 403 `limit_exceeded` before any take or file exists, when the
 * limit is on and no seconds are left, or the optional duration hint is more than what is left.
 * The hint is advisory (the probe's real duration decides), so a missing secret or any trouble
 * reading usage lets the upload go on.
 */
async function earlyRefusal(
  creator: { readonly db: Db; readonly creatorId: string },
  input: unknown,
  deps: HttpDeps,
): Promise<Response | null> {
  if (!deps.usageSecret) return null;
  try {
    const usage = await usageForCreator(creator.db, {
      creatorId: creator.creatorId,
      usageSecret: deps.usageSecret(),
      now: deps.now?.() ?? new Date(),
    });
    if (!usage.ok || !usage.data.enforced) return null;
    const hint = hintSchema.safeParse(input);
    const hintSeconds = hint.success ? hint.data.durationHintMs : undefined;
    const tooLong =
      hintSeconds !== undefined && Math.ceil(hintSeconds / 1000) > usage.data.remainingSeconds;
    if (usage.data.remainingSeconds > 0 && !tooLong) return null;
    // Spec 0016 AC-4: refused before any take exists, so no take ID. Best effort.
    await recordEvent(creator.db, {
      name: "limit_hit",
      creatorId: creator.creatorId,
      props: { place: "upload_start" },
    });
    const when = shortDate(usage.data.resetsOn);
    const message =
      usage.data.remainingSeconds > 0
        ? `This video is longer than the minutes you have left this month. Try a shorter one, or come back on ${when}.`
        : `This month's allowance is used up. Your minutes come back on ${when}.`;
    return Response.json(
      { error: "limit_exceeded", message, ...usageNumbers(usage.data) },
      { status: 403, headers: PRIVATE_NO_STORE },
    );
  } catch {
    return null;
  }
}

/** `POST /api/uploads` */
export async function handleCreate(request: Request, deps: HttpDeps): Promise<Response> {
  const creator = await guard(request, deps);
  if (creator instanceof Response) return creator;
  const input = await body(request);
  const refused = await earlyRefusal(creator, input, deps);
  if (refused) return refused;
  const result = await createUpload(deps.uploadDeps(creator.db), creator.creatorId, input);
  return result.ok ? json(result.data, 201) : errorResponse(result.error);
}

/** `POST /api/uploads/{takeId}/parts` */
export async function handleParts(
  request: Request,
  takeId: string,
  deps: HttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps);
  if (creator instanceof Response) return creator;
  const result = await presignParts(
    deps.uploadDeps(creator.db),
    creator.creatorId,
    takeId,
    await body(request),
  );
  return result.ok ? json(result.data, 200) : errorResponse(result.error);
}

/** `POST /api/uploads/{takeId}/complete` */
export async function handleComplete(
  request: Request,
  takeId: string,
  deps: HttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps);
  if (creator instanceof Response) return creator;
  const result = await completeUpload(
    deps.uploadDeps(creator.db),
    creator.creatorId,
    takeId,
    await body(request),
  );
  return result.ok ? json(result.data, 200) : errorResponse(result.error);
}

/** `DELETE /api/uploads/{takeId}` */
export async function handleAbort(
  request: Request,
  takeId: string,
  deps: HttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps);
  if (creator instanceof Response) return creator;
  const result = await abortUpload(deps.uploadDeps(creator.db), creator.creatorId, takeId);
  return result.ok ? json(result.data, 200) : errorResponse(result.error);
}
