import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { mcpResource } from "../auth";
import { getAuth } from "../request";
import { parseWebEnv } from "@/lib/env";

/**
 * The two OAuth discovery documents (spec 0019 AC-13). The authorization server is Better Auth,
 * whose endpoints live under `/api/auth/oauth2/*`; the documents are served from the root
 * `/.well-known/*` because a client looks there first.
 */

/** RFC 9728: the `/mcp` resource, the authorization server that issues tokens for it, header only. */
export function protectedResourceMetadata(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    resource: mcpResource({ BETTER_AUTH_URL: base }),
    authorization_servers: [`${base}/api/auth`],
    bearer_methods_supported: ["header"],
  } as const;
}

const CACHE = "public, max-age=300";

export function protectedResourceResponse(): Response {
  return Response.json(protectedResourceMetadata(parseWebEnv().BETTER_AUTH_URL), {
    headers: { "cache-control": CACHE },
  });
}

/** RFC 8414: issuer, endpoints, S256 only, from Better Auth's own configuration. */
export async function authServerResponse(request: Request): Promise<Response> {
  const auth = await getAuth();
  return oauthProviderAuthServerMetadata(auth, { headers: { "cache-control": CACHE } })(request);
}
