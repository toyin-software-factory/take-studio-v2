import { parseWebEnv } from "@/lib/env";
import { createAuth } from "./auth";
import type { ApiAuthDeps, Creator } from "./api-auth";
import { getDb } from "./request";

/** The cookie session over the request's database client: the only session lookup of the API. */
export async function sessionCreator(request: Request): Promise<Creator | null> {
  const db = await getDb();
  const session = await createAuth(db, parseWebEnv()).api.getSession({ headers: request.headers });
  return session ? { db, creatorId: session.user.id } : null;
}

/** The real identity dependencies every route's `deps.ts` spreads in (spec 0018 AC-5). */
export function apiAuthDeps(): Required<
  Pick<ApiAuthDeps, "getCreator" | "allowedOrigin" | "keyAuth">
> {
  return {
    getCreator: sessionCreator,
    allowedOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    keyAuth: { getDb },
  };
}
