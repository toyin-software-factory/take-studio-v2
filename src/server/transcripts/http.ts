import { z } from "zod";
import { downloadBody, downloadFormatSchema, downloadHeaders } from "@/lib/transcript-download";
import { recordEvent } from "../analytics/record";
import { type TakeHttpDeps, errorResponse, guard, json } from "../takes/http";
import {
  type MakeError,
  getTranscriptView,
  getTrimmedForCreator,
  makeTranscript,
  setEditUndone,
} from ".";

/** What the transcript routes need: the session and the app origin (reads skip the Origin check). */
export type TranscriptHttpDeps = Pick<TakeHttpDeps, "getCreator" | "allowedOrigin" | "now"> & {
  /** Triggers `transcribe-take` for a job (global key `transcribe-{jobId}`); only POST needs it. */
  readonly triggerTranscribe?: (jobId: string) => Promise<{ readonly id: string }>;
};

/**
 * GET /api/takes/{id}/transcript/{format} (spec 0007, AC-4, AC-5, AC-10): the transcript as
 * `txt`, `srt` or `vtt`, on the trimmed timeline (`?timeline=original`: the original's own timeline, for the cut review preview). 401 without a session; 404 (the take's own
 * not found body) for another creator's take, a take with no transcript, or a transcript with
 * no kept words; 422 for any other format. Never cached, because it holds personal data.
 */
export async function handleTranscriptDownload(
  request: Request,
  takeId: string,
  format: string,
  deps: TranscriptHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const timeline =
    new URL(request.url).searchParams.get("timeline") === "original" ? "original" : "render";
  const view = await getTrimmedForCreator(creator.db, creator.creatorId, takeId, timeline);
  if (!view.ok) return errorResponse("not_found");

  const parsed = downloadFormatSchema.safeParse(format);
  if (!parsed.success) {
    return json(
      { error: "invalid_format", message: "Choose text (txt), captions (srt) or vtt." },
      422,
    );
  }
  const body = downloadBody(parsed.data, view.data.paragraphs);
  if (body === null) return errorResponse("not_found");
  // Spec 0016 AC-5: a transcript file is served. Best effort, the file is sent either way.
  await recordEvent(creator.db, {
    name: "transcript_downloaded",
    creatorId: creator.creatorId,
    takeId,
    props: { kind: `transcript_${parsed.data}` },
  });
  return new Response(body, {
    status: 200,
    headers: downloadHeaders(parsed.data, view.data.title),
  });
}

/**
 * GET /api/takes/{id}/transcript (spec 0007, AC-11): session and ownership checked, another
 * creator's take (or a malformed ID) is 404. Responses are `no-store`; nothing is logged.
 */
export async function handleGetTranscript(
  request: Request,
  takeId: string,
  deps: TranscriptHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const view = await getTranscriptView(
    creator.db,
    creator.creatorId,
    takeId,
    deps.now?.() ?? new Date(),
  );
  if (!view.ok) return errorResponse("not_found");
  return json(view.data);
}

const MAKE_STATUS: Readonly<Record<MakeError, number>> = {
  not_found: 404,
  job_active: 409,
  original_gone: 409,
  already_done: 409,
  not_ready: 409,
  dispatch_failed: 503,
};

/** Friendly messages (spec 0007, AC-9). */
export const MAKE_MESSAGES: Readonly<Record<MakeError, string>> = {
  not_found: "We couldn't find that take.",
  job_active: "Your transcript is still being made. Try again in a moment.",
  original_gone: "This take's video has expired, so a transcript can't be made.",
  already_done: "This take already has a transcript.",
  not_ready: "This take isn't ready yet. Try again when it is.",
  dispatch_failed: "The transcript didn't start. Please try again.",
};

/**
 * POST /api/takes/{id}/transcript (spec 0007, AC-9, AC-11): Make transcript or Try again.
 * Checks run in order: Origin (403), session (401), ownership (404), then the start refusals
 * as 409 (`job_active`, `original_gone`, `already_done`, `not_ready`). 202 `{ state: "making" }`.
 */
export async function handleMakeTranscript(
  request: Request,
  takeId: string,
  deps: TranscriptHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  if (!deps.triggerTranscribe) {
    return json({ error: "dispatch_failed", message: MAKE_MESSAGES.dispatch_failed }, 503);
  }
  const made = await makeTranscript(
    creator.db,
    creator.creatorId,
    takeId,
    deps.triggerTranscribe,
    deps.now?.() ?? new Date(),
  );
  if (!made.ok) {
    return json({ error: made.error, message: MAKE_MESSAGES[made.error] }, MAKE_STATUS[made.error]);
  }
  return json({ state: "making" }, 202);
}

const undoBodySchema = z.strictObject({ undone: z.boolean() });
const indexSchema = z.string().regex(/^(0|[1-9]\d{0,8})$/);

/**
 * PATCH /api/takes/{id}/transcript/edits/{index} (spec 0012, AC-4, AC-11): undo (`undone: true`)
 * or redo one AI word fix. Checks run in order: Origin (403), session (401),
 * the index and body (404 for a malformed index, 422 for a bad body), then ownership and an
 * existing fix at that index (404, the take's own not found body). 200
 * `{ edit, version }`. Nothing from the body or the transcript is logged.
 */
export async function handlePatchEdit(
  request: Request,
  takeId: string,
  index: string,
  deps: TranscriptHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const position = indexSchema.safeParse(index);
  if (!position.success) return errorResponse("not_found");
  const body = undoBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json({ error: "invalid_body", message: "Send undone as true or false." }, 422);
  }
  const result = await setEditUndone(
    creator.db,
    creator.creatorId,
    takeId,
    Number(position.data),
    body.data.undone,
    deps.now?.() ?? new Date(),
  );
  if (!result.ok) return errorResponse("not_found");
  return json(result.data);
}
