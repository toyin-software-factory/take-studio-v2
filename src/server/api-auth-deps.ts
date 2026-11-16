import { parseWebEnv } from "@/lib/env";
import { createAuth, mcpResource } from "./auth";
import type { ApiAuthDeps, Creator } from "./api-auth";
import { getDb } from "./request";
import { guestCookieValue, liveGuest } from "./guest/session";

/** The cookie session over the request's database client: the only session lookup of the API. */
export async function sessionCreator(request: Request): Promise<Creator | null> {
  const db = await getDb();
  const session = await createAuth(db, parseWebEnv()).api.getSession({ headers: request.headers });
  return session ? { db, creatorId: session.user.id } : null;
}

/** The guest cookie's guest for one of its own takes (spec 0023). Only opt in routes call it. */
export async function guestCreator(request: Request, takeId?: string): Promise<Creator | null> {
  const cookie = guestCookieValue(request.headers.get("cookie"));
  if (!cookie) return null;
  return liveGuest(await getDb(), cookie, new Date(), takeId);
}

/** The real identity dependencies every route's `deps.ts` spreads in (spec 0018 AC-5). */
export function apiAuthDeps(): Required<
  Pick<ApiAuthDeps, "getCreator" | "getGuest" | "allowedOrigin" | "keyAuth">
> {
  return {
    getCreator: sessionCreator,
    getGuest: guestCreator,
    allowedOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    keyAuth: { getDb, oauthResource: mcpResource(parseWebEnv()) },
  };
}
