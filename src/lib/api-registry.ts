/**
 * The public API registry (spec 0018 AC-8, AC-16). Pure data: one entry per public method and
 * path, and one typed exclusion for every route that is not public. `api-registry.test.ts` walks
 * every `route.ts` under `src/app/api` and fails when an exported method is in neither list, so a
 * new web action cannot ship without an API decision. Paths use the folder names of the route
 * files with `[name]` written as `{name}` (the OpenAPI form). `request` and `response` are the
 * names of the zod schemas in `src/lib/api-schemas/` (the docs, `/api/openapi.json` and the schema
 * test read them). The docs page, `/api/openapi.json` and the MCP server read this list. A route
 * with `mcp` is one tool of the MCP server (spec 0019 AC-4); a creator route with no tool is in
 * `MCP_EXCLUSIONS` with its reason.
 *
 * Split by job (B2-T116): `api-registry-types` (the shapes and `routeKey`), `api-registry-routes`
 * (the public routes) and `api-registry-exclusions` (the two exclusion lists). This file only
 * re-exports them.
 */
export {
  API_METHODS,
  routeKey,
  type ApiAuth,
  type ApiExclusion,
  type ApiMethod,
  type ApiRoute,
  type ExclusionReason,
} from "./api-registry-types";
export { API_REGISTRY } from "./api-registry-routes";
export { API_EXCLUSIONS, MCP_EXCLUSIONS, type McpExclusion } from "./api-registry-exclusions";
