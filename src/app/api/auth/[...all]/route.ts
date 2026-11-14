import { SESSION_REQUIRED_MESSAGE } from "@/lib/session-required";
import { getAuth } from "@/server/request";

/**
 * A confidential OAuth client authenticates at the token and revoke endpoints with HTTP Basic
 * (spec 0019 AC-13). Those two never read the cookie session, so the header is allowed there and
 * nowhere else; a bearer value is still refused.
 */
function isClientAuth(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return (
    request.method === "POST" &&
    (pathname === "/api/auth/oauth2/token" || pathname === "/api/auth/oauth2/revoke") &&
    /^Basic /i.test(request.headers.get("authorization") ?? "")
  );
}

/**
 * Hands every /api/auth/* request to a per request Better Auth instance. Spec 0018 AC-4: sign in,
 * email, password and delete account are session only, so any request with an Authorization
 * header is refused here before Better Auth runs and the cookie is never read beside a bearer.
 */
async function handle(request: Request): Promise<Response> {
  if (request.headers.has("authorization") && !isClientAuth(request)) {
    return Response.json(
      { error: "session_required", message: SESSION_REQUIRED_MESSAGE },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  const auth = await getAuth();
  return auth.handler(request);
}

export { handle as GET, handle as POST };
