import { z } from "zod";
import { MEDIA_KINDS, type MediaKind, chooseMedia, downloadFileName } from "@/lib/take-media";
import { MEDIA_LINKS } from "@/lib/uploads";
import { getForCreator } from "../takes";
import { type Creator, errorResponse, guard, json } from "../takes/http";

/**
 * GET /api/takes/{id}/media?kind=play|download|original (spec 0004, AC-9, AC-11, AC-12):
 * a presigned R2 link issued only after the ownership check. `play` lasts 1 hour and is
 * inline; `download` and `original` last 15 minutes as attachments named from the title.
 * 404 (same body as every other route) when there is no such take or no file, 410 once the
 * video expired. The link is returned, never logged.
 */

export type MediaHttpDeps = {
  readonly getCreator: (request: Request) => Promise<Creator | null>;
  readonly allowedOrigin: string;
  readonly headObject: (key: string) => Promise<{ readonly size: number } | null>;
  readonly presignGet: (
    key: string,
    options: {
      readonly expiresSeconds: number;
      readonly disposition: { readonly type: "inline" | "attachment"; readonly fileName: string };
    },
  ) => Promise<string>;
  readonly now?: () => Date;
};

const kindSchema = z.enum(MEDIA_KINDS as [MediaKind, ...MediaKind[]]);

export async function handleMedia(
  request: Request,
  takeId: string,
  deps: MediaHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const found = await getForCreator(creator.db, creator.creatorId, takeId);
  if (!found.ok) return errorResponse("not_found");
  // An unknown kind looks like any other missing file.
  const kind = kindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return errorResponse("not_found");

  const { take, latestRender } = found.data;
  const choice = chooseMedia(kind.data, take, latestRender, deps.now?.() ?? new Date());
  if (!choice.ok) return errorResponse(choice.error);

  let stored: { readonly size: number } | null;
  try {
    stored = await deps.headObject(choice.key);
  } catch {
    return errorResponse("storage_error");
  }
  if (!stored) return errorResponse("not_found");

  const play = kind.data === "play";
  const url = await deps.presignGet(choice.key, {
    expiresSeconds: play ? MEDIA_LINKS.playSeconds : MEDIA_LINKS.downloadSeconds,
    disposition: {
      type: play ? "inline" : "attachment",
      fileName: downloadFileName(take.title, choice.file, take.container),
    },
  });
  return json({
    url,
    expiresInSeconds: play ? MEDIA_LINKS.playSeconds : MEDIA_LINKS.downloadSeconds,
  });
}
