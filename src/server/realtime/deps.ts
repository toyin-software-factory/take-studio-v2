import { parseUsageEnv, realtimeEnvSchema } from "@/lib/env";
import { apiAuthDeps } from "../api-auth-deps";
import type { RealtimeHttpDeps } from "./http";

/** The real dependencies of the token route: the cookie session over the request's database. */
export function realtimeHttpDeps(): RealtimeHttpDeps {
  const { getCreator, allowedOrigin } = apiAuthDeps();
  return {
    allowedOrigin,
    getCreator,
    deepgramKey: () => {
      const parsed = realtimeEnvSchema.safeParse(process.env);
      return parsed.success ? parsed.data.DEEPGRAM_REALTIME_API_KEY : null;
    },
    usageSecret: () => {
      try {
        return parseUsageEnv().USAGE_HASH_SECRET;
      } catch {
        return null;
      }
    },
    log: (message, fields) => console.error(message, fields),
  };
}
