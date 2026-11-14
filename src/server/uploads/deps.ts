import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { triggerProbe } from "@/lib/trigger-runs";
import { apiAuthDeps } from "../api-auth-deps";
import type { HttpDeps } from "./http";

/**
 * The real dependencies of the upload routes: the session from Better Auth over the
 * request's database client, the app origin from BETTER_AUTH_URL, R2 and Trigger.dev.
 */
export function uploadHttpDeps(): HttpDeps {
  const env = parseWebEnv();
  return {
    ...apiAuthDeps(),
    usageSecret: () => parseUsageEnv().USAGE_HASH_SECRET,
    uploadDeps: (db) => ({ db, r2: createR2(env), dispatchProbe: triggerProbe }),
  };
}
