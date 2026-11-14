import { apiAuthDeps } from "../api-auth-deps";
import type { ConnectedAppsDeps } from "./http";

/** The real dependencies: the cookie session only, never a bearer token. */
export function connectedAppsDeps(): ConnectedAppsDeps {
  const { getCreator, allowedOrigin } = apiAuthDeps();
  return { getCreator, allowedOrigin };
}
