import { z } from "zod";
import { CHANGE_MESSAGES, type ChangeErrorCode } from "@/lib/change-messages";
import { type TakeHttpDeps, errorResponse, guard, json } from "../takes/http";
import { hasActiveTranscribe } from "../transcripts";
import { jobStatusForCreator, startChanges, waveformForCreator } from ".";

export type ChangesHttpDeps = Pick<
  TakeHttpDeps,
  "getCreator" | "allowedOrigin" | "triggerProcessTake" | "now"
>;

const STATUS: Readonly<Record<ChangeErrorCode, number>> = {
  not_found: 404,
  invalid: 422,
  job_active: 409,
  invalid_transition: 409,
  original_gone: 409,
  nothing_changed: 409,
  no_green_screen: 409,
  background_not_ready: 409,
  background_missing: 409,
  stale: 409,
  change_limit: 429,
  dispatch_failed: 503,
};

/** The wording when a transcript is what is running (spec 0007 and 0011). */
const TRANSCRIPT_RUNNING = "Your transcript is still being made. Try again in a moment.";

const body = z.object({
  baseRenderId: z.uuid().nullable(),
  background: z.object({ id: z.uuid().nullable() }).optional(),
  cuts: z
    .array(z.object({ id: z.uuid(), applied: z.boolean() }))
    .max(2000)
    .refine((cuts) => new Set(cuts.map((c) => c.id)).size === cuts.length)
    .optional(),
});

function refusal(code: ChangeErrorCode, message = CHANGE_MESSAGES[code]): Response {
  return json({ error: code, message }, STATUS[code]);
}

/**
 * POST /api/takes/{id}/changes (spec 0011): one free re render carrying a background choice and
 * cut changes. Origin (403), session (401), body (422), then ownership (404) and the refusals
 * (409, 422, 429). 202 `{ jobId }`; the take stays Ready with its current video playable.
 */
export async function handleChanges(
  request: Request,
  takeId: string,
  deps: ChangesHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refusal("invalid", "Those changes can't be read. Reload the page.");
  const { baseRenderId, background, cuts = [] } = parsed.data;
  const started = await startChanges(
    creator.db,
    {
      creatorId: creator.creatorId,
      takeId,
      baseRenderId,
      background,
      cuts: cuts.map((c) => ({ cutId: c.id, applied: c.applied })),
      now: deps.now?.() ?? new Date(),
    },
    deps.triggerProcessTake,
  );
  if (!started.ok) {
    const code: ChangeErrorCode =
      started.error === "background_change_limit" ? "change_limit" : started.error;
    if (code === "job_active" && (await hasActiveTranscribe(creator.db, takeId))) {
      return refusal(code, TRANSCRIPT_RUNNING);
    }
    return refusal(code);
  }
  return json({ jobId: started.data.jobId }, 202);
}

/** GET /api/takes/{id}/jobs/{jobId}: `{ status }` of one job of this take (404 when not theirs). */
export async function handleJobStatus(
  request: Request,
  takeId: string,
  jobId: string,
  deps: ChangesHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const found = await jobStatusForCreator(creator.db, creator.creatorId, takeId, jobId);
  return found ? json({ status: found.status }) : errorResponse("not_found");
}

/** GET /api/takes/{id}/waveform: `{ waveform }`, null until it is computed (spec 0011, AC-11). */
export async function handleWaveform(
  request: Request,
  takeId: string,
  deps: ChangesHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const waveform = await waveformForCreator(creator.db, creator.creatorId, takeId);
  return waveform === undefined ? errorResponse("not_found") : json({ waveform });
}
