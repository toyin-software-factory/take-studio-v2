import { z } from "zod";
import { API_RATE } from "./api-rules";
import { API_REGISTRY, routeKey, type ApiRoute } from "./api-registry";

/**
 * The OpenAPI 3.1 file, built from the registry (spec 0018 AC-11). Pure: the route lists the
 * registry owns, and a schema is added to an operation only when the lookup returns one for the
 * entry's `request` or `response` name (the schemas live in `src/lib/api-schemas/`, step 4).
 * JSON Schema comes from zod 4's own `z.toJSONSchema`. Used by `/api/openapi.json`.
 */

export const API_VERSION = "v1";

/** Finds a zod schema by the name a registry entry gives it, or undefined when there is none yet. */
export type ApiSchemaLookup = (name: string) => z.ZodType | undefined;

type Json = Record<string, unknown>;

const ERROR_SCHEMA_REF = { $ref: "#/components/schemas/ApiError" } as const;

/** `/api/takes/{id}/media` → `getTakesIdMedia`-style IDs would drift; this one is stable and unique. */
export function operationId(route: Pick<ApiRoute, "method" | "path">): string {
  const words = route.path
    .replace(/^\/api\//, "")
    .split("/")
    .map((part) => part.replace(/^\{(?:\.\.\.)?(.+)\}$/, "By_$1"));
  return [route.method.toLowerCase(), ...words]
    .join("_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/_+/g, "_");
}

/** The `{name}` parts of a path, in order. */
export function pathParams(path: string): readonly string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? "");
}

/** Requests read as input (a defaulted field may be left out), responses as output. */
function jsonSchemaOf(
  schema: z.ZodType | undefined,
  io: "input" | "output" = "output",
): Json | undefined {
  if (!schema) return undefined;
  return Object.fromEntries(
    Object.entries(z.toJSONSchema(schema, { io }) as Json).filter(([key]) => key !== "$schema"),
  );
}

/** Query parameters from an object schema, for an operation that has a request but no body. */
function queryParameters(schema: Json | undefined): readonly Json[] {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") return [];
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
  return Object.entries(properties as Json).map(([name, field]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: field,
  }));
}

function operation(route: ApiRoute, lookup: ApiSchemaLookup): Json {
  const request = jsonSchemaOf(route.request ? lookup(route.request) : undefined, "input");
  const response = jsonSchemaOf(route.response ? lookup(route.response) : undefined);
  const hasBody = route.method === "POST" || route.method === "PUT" || route.method === "PATCH";
  const params = pathParams(route.path);
  const parameters: readonly Json[] = [
    ...params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
    ...(hasBody ? [] : queryParameters(request)),
  ];
  return {
    operationId: operationId(route),
    summary: route.summary,
    security: [{ bearerAuth: [] }],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(request && hasBody
      ? { requestBody: { required: true, content: { "application/json": { schema: request } } } }
      : {}),
    responses: {
      [route.noContent ? "204" : "2XX"]: {
        description: route.noContent ? "Done. There is no body." : "Success.",
        ...(response
          ? {
              content: route.text
                ? Object.fromEntries(
                    TEXT_TYPES.map((type) => [type, { schema: { type: "string" } }]),
                  )
                : { "application/json": { schema: response } },
            }
          : {}),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      ...(params.length > 0 ? { "404": { $ref: "#/components/responses/NotFound" } } : {}),
      "429": { $ref: "#/components/responses/RateLimited" },
    },
  };
}

/** The transcript download: text, SubRip (srt) or WebVTT, picked by `format`. */
const TEXT_TYPES = ["text/plain", "application/x-subrip", "text/vtt"] as const;

function errorResponse(description: string): Json {
  return {
    description,
    content: { "application/json": { schema: ERROR_SCHEMA_REF } },
  };
}

/** The whole OpenAPI 3.1 document. `origin` becomes the server URL when it is known. */
export function buildOpenApi({
  registry = API_REGISTRY,
  schemas = () => undefined,
  origin = null,
}: {
  readonly registry?: readonly ApiRoute[];
  readonly schemas?: ApiSchemaLookup;
  readonly origin?: string | null;
} = {}): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const route of registry) {
    paths[route.path] = {
      ...paths[route.path],
      [route.method.toLowerCase()]: operation(route, schemas),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Take Studio API",
      version: API_VERSION,
      description:
        "Do from your own code what you can do in Take Studio. Send an API key as a bearer token. " +
        "This is v1: changes are additive, and a breaking change gets a new version path.",
    },
    ...(origin ? { servers: [{ url: origin }] } : {}),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "tsk_ key",
          description:
            "A key made on the API keys screen. Send it as `Authorization: Bearer tsk_…`.",
        },
      },
      schemas: {
        ApiError: {
          type: "object",
          required: ["error", "message"],
          properties: {
            error: { type: "string", description: "A short code you can match on." },
            message: { type: "string", description: "A sentence for a person." },
          },
        },
      },
      responses: {
        Unauthorized: errorResponse(
          "No key, or a key that is wrong or revoked (`invalid_api_key`).",
        ),
        NotFound: errorResponse("Not found, or not yours (`not_found`)."),
        RateLimited: {
          ...errorResponse(
            `More than ${API_RATE.perMinute} requests in a minute for this key (\`rate_limited\`).`,
          ),
          headers: {
            "Retry-After": {
              description: "Seconds until the next minute starts.",
              schema: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
  };
}

/** `"METHOD path"` keys of every operation in a built document. */
export function documentedKeys(document: Json): readonly string[] {
  const paths = (document.paths ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) =>
      routeKey({ method: method.toUpperCase() as ApiRoute["method"], path }),
    ),
  );
}
