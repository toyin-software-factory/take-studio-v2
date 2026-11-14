import { authServerResponse } from "@/server/oauth/metadata";

export const dynamic = "force-dynamic";

/** Spec 0019 AC-13: issuer, authorize, token and registration endpoints, S256 only. */
export function GET(request: Request): Promise<Response> {
  return authServerResponse(request);
}
