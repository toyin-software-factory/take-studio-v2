import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { createAuth } from "../auth";
import { getDb } from "../request";
import type { UsageHttpDeps } from "./http";

/** The real dependencies of GET /api/usage: the session over the request's database client. */
export function usageHttpDeps(): UsageHttpDeps {
  return {
    getCreator: async (request) => {
      const db = await getDb();
      const session = await createAuth(db, parseWebEnv()).api.getSession({
        headers: request.headers,
      });
      return session ? { db, creatorId: session.user.id } : null;
    },
    usageSecret: () => parseUsageEnv().USAGE_HASH_SECRET,
  };
}
