import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { triggerForJob, triggerForTranscribe } from "@/lib/trigger-runs";
import { apiAuthDeps, sessionCreator } from "../api-auth-deps";
import type { MediaHttpDeps } from "../media";
import type { TranscriptHttpDeps } from "../transcripts/http";
import type { TakeHttpDeps } from "./http";

/**
 * The real dependencies of the take and media routes: the session from Better Auth over the
 * request's database client, the app origin from BETTER_AUTH_URL, Trigger.dev and R2.
 */
const getCreator = sessionCreator;

export function takeHttpDeps(): TakeHttpDeps {
  return {
    ...apiAuthDeps(),
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

export function transcriptHttpDeps(): TranscriptHttpDeps {
  return {
    allowedOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    getCreator,
    triggerTranscribe: triggerForTranscribe(),
  };
}
