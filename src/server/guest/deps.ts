import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { triggerProbe } from "@/lib/trigger-runs";
import { getDb } from "../request";
import type { GuestHttpDeps } from "./http";

/** The real dependencies of the guest drop box route (spec 0023). */
export function guestHttpDeps(): GuestHttpDeps {
  const env = parseWebEnv();
  const url = new URL(env.BETTER_AUTH_URL);
  return {
    appOrigin: url.origin,
    secureCookie: url.protocol === "https:",
    hashSecret: () => parseUsageEnv().USAGE_HASH_SECRET,
    env: process.env,
    uploadDeps: async () => ({ db: await getDb(), r2: createR2(env), dispatchProbe: triggerProbe }),
  };
}
