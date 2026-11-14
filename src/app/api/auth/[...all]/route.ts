import { getAuth } from "@/server/request";

/**
 * Hands every /api/auth/* request to a per request Better Auth instance. Spec 0018 AC-4: sign in,
 * email, password and delete account are session only, so any request with an Authorization
 * header is refused here before Better Auth runs and the cookie is never read beside a bearer.
 */
async function handle(request: Request): Promise<Response> {
  if (request.headers.has("authorization")) {
    return Response.json(
      { error: "session_required", message: "This action needs you to be signed in on the web." },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  const auth = await getAuth();
  return auth.handler(request);
}

export { handle as GET, handle as POST };
