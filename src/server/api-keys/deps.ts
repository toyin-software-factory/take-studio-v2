import { sessionCreator } from "../api-auth-deps";
import { parseWebEnv } from "@/lib/env";
import type { ApiKeyHttpDeps } from "./http";

/** The real dependencies of the key routes: the cookie session only, never a bearer key. */
export function apiKeyHttpDeps(): ApiKeyHttpDeps {
  return {
    allowedOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    getCreator: sessionCreator,
  };
}
