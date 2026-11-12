import { type TakeHttpDeps, guard, json } from "../takes/http";
import {
  type BackgroundUploadError,
  type UploadPorts,
  completeBackground,
  createBackground,
  removeBackground,
} from "./upload";

/**
 * HTTP handlers for uploading and deleting backgrounds (spec 0008, API surface): session
 * required, `Origin` checked on every one (they all change something), friendly errors.
 */
export type UploadHttpDeps = Pick<TakeHttpDeps, "getCreator" | "allowedOrigin"> & {
  readonly ports: (db: UploadPorts["db"]) => UploadPorts;
  /** Starts a storage queue drain, best effort. */
  readonly requestDrain: () => Promise<void>;
};

const STATUS: Readonly<Record<BackgroundUploadError, number>> = {
  invalid: 422,
  unsupported_type: 422,
  too_large: 422,
  rate_limited: 429,
  library_full: 409,
  not_found: 404,
  not_uploaded: 409,
  in_use: 409,
  storage_error: 503,
  dispatch_failed: 503,
};

const MESSAGES: Readonly<Record<BackgroundUploadError, string>> = {
  invalid: "Enter a name between 1 and 80 characters and choose an image.",
  unsupported_type: "Choose a JPEG, PNG or WebP image.",
  too_large: "That image is over 10 MB. Choose a smaller one.",
  rate_limited: "You've added 20 backgrounds in the last hour. Try again a little later.",
  library_full: "Your library has 100 backgrounds. Delete one to add another.",
  not_found: "We couldn't find that background.",
  not_uploaded: "That image hasn't finished uploading. Please send it again.",
  in_use: "In use, try again in a minute.",
  storage_error: "Storage is having a problem right now. Please try again.",
  dispatch_failed: "We couldn't start processing that image. Please upload it again.",
};

function errorResponse(code: BackgroundUploadError): Response {
  return json({ error: code, message: MESSAGES[code] }, STATUS[code]);
}

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** `POST /api/backgrounds`: `{ id, uploadUrl }` (201). */
export async function handleCreateBackground(
  request: Request,
  deps: UploadHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const result = await createBackground(
    deps.ports(creator.db),
    creator.creatorId,
    await body(request),
  );
  return result.ok ? json(result.data, 201) : errorResponse(result.error);
}

/** `POST /api/backgrounds/{id}/complete`: `{ status: "processing" }`. */
export async function handleCompleteBackground(
  request: Request,
  id: string,
  deps: UploadHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const result = await completeBackground(deps.ports(creator.db), creator.creatorId, id);
  return result.ok ? json(result.data, 200) : errorResponse(result.error);
}

/** `DELETE /api/backgrounds/{id}`: 204 and its files queued for deletion. */
export async function handleDeleteBackground(
  request: Request,
  id: string,
  deps: UploadHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const result = await removeBackground(deps.ports(creator.db), creator.creatorId, id);
  if (!result.ok) return errorResponse(result.error);
  await deps.requestDrain().catch(() => undefined);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
