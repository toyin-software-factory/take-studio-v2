import { parseUsageEnv, parseWebEnv, realtimeEnvSchema } from "@/lib/env";
import { sessionCreator } from "../api-auth-deps";
import type { RealtimeHttpDeps } from "./http";

/** The real dependencies of the token route: the cookie session over the request's database. */
export function realtimeHttpDeps(): RealtimeHttpDeps {
  return {
    allowedOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    getCreator: sessionCreator,
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
