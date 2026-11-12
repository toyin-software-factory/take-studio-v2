import { MEDIA_LINKS } from "@/lib/uploads";
import { type TakeHttpDeps, guard, json } from "../takes/http";
import { listBackgrounds } from ".";

/** What the backgrounds routes need: the session, the app origin and R2 links for thumbnails. */
export type BackgroundHttpDeps = Pick<TakeHttpDeps, "getCreator" | "allowedOrigin"> & {
  readonly presignGet: (
    key: string,
    options: { readonly expiresSeconds: number },
  ) => Promise<string>;
};

/**
 * GET /api/backgrounds (spec 0008, AC-1): `{ builtIn, mine, defaultId }`, each item
 * `{ id, name, alt, status, thumbUrl }` with a 1 hour presigned thumbnail link. 401 without a
 * session. A read, so no Origin check. Never cached.
 */
export async function handleListBackgrounds(
  request: Request,
  deps: BackgroundHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const list = await listBackgrounds(creator.db, creator.creatorId, (key) =>
    deps.presignGet(key, { expiresSeconds: MEDIA_LINKS.playSeconds }),
  );
  return json(list);
}
