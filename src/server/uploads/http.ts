import type { Db } from "@/db/types";
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
};

const STATUS: Readonly<Record<UploadError, number>> = {
  invalid: 422,
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

/** `POST /api/uploads` */
export async function handleCreate(request: Request, deps: HttpDeps): Promise<Response> {
  const creator = await guard(request, deps);
  if (creator instanceof Response) return creator;
  const result = await createUpload(
    deps.uploadDeps(creator.db),
    creator.creatorId,
    await body(request),
  );
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
