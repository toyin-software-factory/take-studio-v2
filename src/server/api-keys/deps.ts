import { parseWebEnv } from "@/lib/env";
import { createAuth } from "../auth";
import { getDb } from "../request";
import type { ApiKeyHttpDeps } from "./http";

/** The real dependencies of the key routes: the cookie session over the request's database. */
export function apiKeyHttpDeps(): ApiKeyHttpDeps {
  return {
    allowedOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    getCreator: async (request) => {
      const db = await getDb();
      const session = await createAuth(db, parseWebEnv()).api.getSession({
        headers: request.headers,
      });
      return session ? { db, creatorId: session.user.id } : null;
    },
  };
}
