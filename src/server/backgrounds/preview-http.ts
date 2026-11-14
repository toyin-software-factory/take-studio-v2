import { z } from "zod";
import { getPreview } from "@/db/data/previews";
import type { BackgroundPreview } from "@/db/types";
import { type TakeHttpDeps, errorResponse, guard, json } from "../takes/http";
import { type PreviewError, previewView, startPreview } from "./preview";

/** What the preview routes need: the session, the app origin, the job trigger and R2 links. */
export type PreviewHttpDeps = Pick<
  TakeHttpDeps,
  "getCreator" | "allowedOrigin" | "keyAuth" | "now"
> & {
  /** Triggers `preview-background` for a preview (concurrency key per take). */
  readonly triggerPreview: (preview: BackgroundPreview) => Promise<unknown>;
  readonly presignGet: (
    key: string,
    options: { readonly expiresSeconds: number },
  ) => Promise<string>;
};

const STATUS: Readonly<Record<PreviewError | "invalid", number>> = {
  not_found: 404,
  invalid: 422,
  original_gone: 409,
  not_ready: 409,
  background_not_ready: 409,
  dispatch_failed: 503,
};

/** Friendly messages (spec 0008, AC-4, AC-6). */
export const PREVIEW_MESSAGES: Readonly<Record<PreviewError | "invalid", string>> = {
  not_found: "We couldn't find that take or background.",
  invalid: "Choose a background to preview.",
  original_gone: "This take's video has expired, so it can't be previewed.",
  not_ready: "This take isn't ready yet. Try again when it is.",
  background_not_ready: "That background isn't ready yet. Try again in a moment.",
  dispatch_failed: "The preview didn't start. Please try again.",
};

const idSchema = z.object({ backgroundId: z.uuid() });

/**
 * POST /api/takes/{id}/background/preview `{ backgroundId }`: starts (or reuses) the still of
 * the take on that background. Origin 403, session 401, body 422, then 404 and 409. 200 with
 * `{ state: "ready", url, noGreenScreen }` for a cache hit, 202 with `{ state: "making" }` while
 * it is made. "Original" never calls this: the page shows the take's thumbnail.
 */
export async function handlePostPreview(
  request: Request,
  takeId: string,
  deps: PreviewHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const parsed = idSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid", message: PREVIEW_MESSAGES.invalid }, 422);
  const started = await startPreview(
    creator.db,
    creator.creatorId,
    takeId,
    parsed.data.backgroundId,
    deps.triggerPreview,
    deps.now?.() ?? new Date(),
  );
  if (!started.ok) {
    return json(
      { error: started.error, message: PREVIEW_MESSAGES[started.error] },
      STATUS[started.error],
    );
  }
  const view = await previewView(started.data, deps.presignGet);
  return json(view, view.state === "making" ? 202 : 200);
}

/**
 * GET /api/takes/{id}/background/preview?backgroundId=: the same view, read only. 404 when the
 * take or background is not theirs or no preview was asked for. No Origin check (a read).
 */
export async function handleGetPreview(
  request: Request,
  takeId: string,
  deps: PreviewHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const parsed = idSchema.safeParse({
    backgroundId: new URL(request.url).searchParams.get("backgroundId"),
  });
  if (!parsed.success) return json({ error: "invalid", message: PREVIEW_MESSAGES.invalid }, 422);
  const found = await getPreview(creator.db, {
    creatorId: creator.creatorId,
    takeId,
    backgroundId: parsed.data.backgroundId,
    now: deps.now?.(),
  });
  if (!found.ok) {
    if (found.error === "original_gone") {
      return json(
        { error: "original_gone", message: PREVIEW_MESSAGES.original_gone },
        STATUS.original_gone,
      );
    }
    return errorResponse("not_found");
  }
  return json(await previewView(found.data, deps.presignGet), 200);
}
