import { takeRenameSchema } from "@/lib/api-schemas/requests";
import type {} from "@/db/types";
import { removedRanges } from "@/lib/cut-rules";
import { isExpired, removedMs, takeNote } from "@/lib/take-media";
import { deleteTake, getForCreator, listForCreator, rename } from ".";
import { listForTake } from "../cuts";
import { cardView, cutView, jobView, renderView, takeView } from "./views";
import { errorResponse, guard, json, readBody, type TakeHttpDeps } from "./http-base";

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
    sourceFps,
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
    // B2-T156: the frame rate the render snapped its cuts to (the page maps the playhead with it).
    sourceFps,
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

// Split by job (B2-T117): the shared types, error maps, `json`, `guard` and `readBody` are in
// `http-base`, the retry handler in `http-retry`. This file keeps the import path stable.
export {
  errorResponse,
  guard,
  json,
  readBody,
  type Creator,
  type TakeError,
  type TakeHttpDeps,
} from "./http-base";
export { handleRetry } from "./http-retry";
