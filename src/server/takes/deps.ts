import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { triggerForJob, triggerForTranscribe } from "@/lib/trigger-runs";
import { apiAuthDeps } from "../api-auth-deps";
import type { MediaHttpDeps } from "../media";
import type { TranscriptHttpDeps } from "../transcripts/http";
import type { TakeHttpDeps } from "./http";

/**
 * The real dependencies of the take, media and transcript routes: the shared identity guard
 * (`apiAuthDeps`: bearer key, else session, spec 0018), Trigger.dev and R2.
 */
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
    ...apiAuthDeps(),
    headObject: (key) => r2.headObject(key),
    presignGet: (key, options) => r2.presignGet(key, options),
  };
}

export function transcriptHttpDeps(): TranscriptHttpDeps {
  return {
    ...apiAuthDeps(),
    triggerTranscribe: triggerForTranscribe(),
  };
}
