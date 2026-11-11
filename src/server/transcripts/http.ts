import { downloadBody, downloadFormatSchema, downloadHeaders } from "@/lib/transcript-download";
import { type TakeHttpDeps, errorResponse, guard, json } from "../takes/http";
import { getTranscriptView, getTrimmedForCreator } from ".";

/** What the transcript routes need: the session and the app origin (reads skip the Origin check). */
export type TranscriptHttpDeps = Pick<TakeHttpDeps, "getCreator" | "allowedOrigin" | "now">;

/**
 * GET /api/takes/{id}/transcript/{format} (spec 0007, AC-4, AC-5, AC-10): the transcript as
 * `txt`, `srt` or `vtt`, on the trimmed timeline. 401 without a session; 404 (the take's own
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
  const view = await getTrimmedForCreator(creator.db, creator.creatorId, takeId);
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
