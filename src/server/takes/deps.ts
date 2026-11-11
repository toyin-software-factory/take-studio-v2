import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { triggerForJob } from "@/lib/trigger-runs";
import { createAuth } from "../auth";
import type { MediaHttpDeps } from "../media";
import { getDb } from "../request";
import type { Creator, TakeHttpDeps } from "./http";

/**
 * The real dependencies of the take and media routes: the session from Better Auth over the
 * request's database client, the app origin from BETTER_AUTH_URL, Trigger.dev and R2.
 */
async function getCreator(request: Request): Promise<Creator | null> {
  const db = await getDb();
  const session = await createAuth(db, parseWebEnv()).api.getSession({
    headers: request.headers,
  });
  return session ? { db, creatorId: session.user.id } : null;
}

export function takeHttpDeps(): TakeHttpDeps {
  return {
    allowedOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    getCreator,
    usageSecret: () => parseUsageEnv().USAGE_HASH_SECRET,
    triggerProcessTake: triggerForJob("process-take"),
  };
}

export function mediaHttpDeps(): MediaHttpDeps {
  const env = parseWebEnv();
  const r2 = createR2(env);
  return {
    allowedOrigin: new URL(env.BETTER_AUTH_URL).origin,
    getCreator,
    headObject: (key) => r2.headObject(key),
    presignGet: (key, options) => r2.presignGet(key, options),
  };
}
