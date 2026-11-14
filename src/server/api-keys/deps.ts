import { apiAuthDeps } from "../api-auth-deps";
import type { ApiKeyHttpDeps } from "./http";

/** The real dependencies of the key routes: the cookie session only, never a bearer key. */
export function apiKeyHttpDeps(): ApiKeyHttpDeps {
  const { getCreator, allowedOrigin } = apiAuthDeps();
  return { getCreator, allowedOrigin };
}
