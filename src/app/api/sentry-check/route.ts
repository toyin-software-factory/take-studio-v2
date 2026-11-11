import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SENTRY_CHECK_HEADER, sentryCheckAllowed } from "@/lib/sentry-check";

export const dynamic = "force-dynamic";

/**
 * Production check for error monitoring (spec 0005, AC-1). Not found unless the request
 * carries the SENTRY_CHECK_TOKEN Worker secret in the `x-sentry-check` header; then it throws
 * a deliberate error, which must reach Sentry with release, environment and `runtime: web`.
 * Kept for future checks. The token never appears in logs or responses.
 */
export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  const expected = (env as { readonly SENTRY_CHECK_TOKEN?: string }).SENTRY_CHECK_TOKEN;
  if (!(await sentryCheckAllowed(request.headers.get(SENTRY_CHECK_HEADER), expected))) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  throw new Error("Sentry check: deliberate server error (spec 0005)");
}
