import { type TakeHttpDeps, errorResponse, guard, json } from "../takes/http";
import { getTranscriptView } from ".";

/**
 * GET /api/takes/{id}/transcript (spec 0007, AC-11): session and ownership checked, another
 * creator's take (or a malformed ID) is 404. Responses are `no-store`; nothing is logged.
 */
export async function handleGetTranscript(
  request: Request,
  takeId: string,
  deps: Pick<TakeHttpDeps, "getCreator" | "allowedOrigin" | "now">,
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
