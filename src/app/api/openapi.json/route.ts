import { buildOpenApi } from "@/lib/api-openapi";
import { siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

/** The OpenAPI 3.1 file for the public API (spec 0018 AC-11): public, no sign in, built from the registry. */
export function GET(): Response {
  const document = buildOpenApi({ origin: siteOrigin(process.env.BETTER_AUTH_URL) });
  return Response.json(document, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
