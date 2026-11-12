import { failPreview, requestPreview } from "@/db/data/previews";
import type { RequestPreviewError } from "@/db/data/previews";
import type { BackgroundPreview, Executor } from "@/db/types";
import { type Result, err, ok } from "@/lib/result";

export type PreviewError = RequestPreviewError | "dispatch_failed";

/**
 * Ask for a still of a take on a background (spec 0008, AC-4): the creator's own take and a
 * background that is built in or theirs (`not_found` otherwise), then `requestPreview` (cache,
 * one at a time, stale replacement) and, when it says so, the dispatch of `preview-background`.
 * A trigger that throws marks the preview `failed` so the next request starts it again, and the
 * caller answers 503: it never sits `making` with no job behind it.
 */
export async function startPreview(
  db: Executor,
  creatorId: string,
  takeId: string,
  backgroundId: string,
  trigger: (preview: BackgroundPreview) => Promise<unknown>,
  now: Date = new Date(),
): Promise<Result<BackgroundPreview, PreviewError>> {
  const requested = await requestPreview(db, { creatorId, takeId, backgroundId, now });
  if (!requested.ok) return err(requested.error);
  const { preview, dispatch } = requested.data;
  if (!dispatch) return ok(preview);
  try {
    await trigger(preview);
  } catch {
    await failPreview(db, preview.id);
    return err("dispatch_failed");
  }
  return ok(preview);
}

/** What the routes send for a preview: its state, a 1 hour link when ready, the no green flag. */
export async function previewView(
  preview: BackgroundPreview,
  presignGet: (key: string, options: { readonly expiresSeconds: number }) => Promise<string>,
): Promise<{ state: string; url?: string; noGreenScreen: boolean }> {
  if (preview.status === "ready" && preview.objectKey) {
    return {
      state: "ready",
      url: await presignGet(preview.objectKey, { expiresSeconds: 60 * 60 }),
      noGreenScreen: preview.noGreenScreen,
    };
  }
  return { state: preview.status, noGreenScreen: preview.noGreenScreen };
}
