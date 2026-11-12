import { z } from "zod";
import { type TakeHttpDeps, guard, json } from "../takes/http";
import { hasActiveTranscribe } from "../transcripts";
import { type ChangeBackgroundError, changeBackground } from ".";

/** What the background routes need: the session, the app origin and the job trigger. */
export type BackgroundHttpDeps = Pick<
  TakeHttpDeps,
  "getCreator" | "allowedOrigin" | "triggerProcessTake" | "now"
>;

const STATUS: Readonly<Record<ChangeBackgroundError | "invalid", number>> = {
  not_found: 404,
  invalid: 422,
  job_active: 409,
  original_gone: 409,
  not_ready: 409,
  same_background: 409,
  background_not_ready: 409,
  dispatch_failed: 503,
};

/** Friendly messages (spec 0008, AC-6). `job_active` has a second wording, below. */
export const BACKGROUND_MESSAGES: Readonly<Record<ChangeBackgroundError | "invalid", string>> = {
  not_found: "We couldn't find that take or background.",
  invalid: "Choose a background, or keep the original.",
  job_active: "Your video is still being made. Try again in a moment.",
  original_gone: "This take's video has expired, so its background can't be changed.",
  not_ready: "This take isn't ready yet. Try again when it is.",
  same_background: "This take already has that background.",
  background_not_ready: "That background isn't ready yet. Try again in a moment.",
  dispatch_failed: "The new video didn't start. Please try again.",
};

/** The transcript wording when a transcript is what is running (spec 0007 and 0008, AC-6). */
export const TRANSCRIPT_RUNNING_MESSAGE =
  "Your transcript is still being made. Try again in a moment.";

const body = z.object({ backgroundId: z.union([z.uuid(), z.literal("original")]) });

/**
 * PUT /api/takes/{id}/background `{ backgroundId }` (an ID, or `"original"`): starts a re render
 * of the take's current cuts onto that background. Checks run in order: Origin (403), session
 * (401), body (422), then ownership (404) and the refusals (409). 202 `{ jobId }`. The take
 * stays Ready and its video playable the whole time.
 */
export async function handleChangeBackground(
  request: Request,
  takeId: string,
  deps: BackgroundHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "invalid", message: BACKGROUND_MESSAGES.invalid }, STATUS.invalid);
  }
  const target = parsed.data.backgroundId === "original" ? null : parsed.data.backgroundId;
  const changed = await changeBackground(
    creator.db,
    creator.creatorId,
    takeId,
    target,
    deps.triggerProcessTake,
    deps.now?.() ?? new Date(),
  );
  if (!changed.ok) {
    // A transcript that is still being made gets its own wording.
    const message =
      changed.error === "job_active" && (await hasActiveTranscribe(creator.db, takeId))
        ? TRANSCRIPT_RUNNING_MESSAGE
        : BACKGROUND_MESSAGES[changed.error];
    return json({ error: changed.error, message }, STATUS[changed.error]);
  }
  return json({ jobId: changed.data.jobId }, 202);
}
