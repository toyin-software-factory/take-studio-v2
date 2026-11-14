import { describe, expect, it } from "vitest";
import { z } from "zod";
import { API_REGISTRY, routeKey, type ApiRoute } from "./api-registry";
import { buildOpenApi, documentedKeys, operationId, pathParams } from "./api-openapi";

type Doc = {
  openapi: string;
  info: { title: string; version: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: {
    securitySchemes: Record<string, unknown>;
    responses: Record<string, { description: string; headers?: Record<string, unknown> }>;
    schemas: Record<string, unknown>;
  };
};

const build = (options?: Parameters<typeof buildOpenApi>[0]) =>
  buildOpenApi(options) as unknown as Doc;

/** Every `$ref` in a document points at something that exists in it. */
function dangling(doc: Doc): string[] {
  const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1] ?? "");
  return refs.filter((ref) => {
    let at: unknown = doc;
    for (const part of ref.split("/")) at = (at as Record<string, unknown> | undefined)?.[part];
    return at === undefined;
  });
}

describe("buildOpenApi (spec 0018 AC-11)", () => {
  it("is an OpenAPI 3.1 document with the bearer key scheme", () => {
    const doc = build({ origin: "https://take.example.com" });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("v1");
    expect(doc.servers).toEqual([{ url: "https://take.example.com" }]);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(build().servers).toBeUndefined();
  });

  it("documents every registry route and nothing else", () => {
    const keys = documentedKeys(build() as never);
    expect([...keys].sort()).toEqual(API_REGISTRY.map(routeKey).sort());
  });

  it("gives each operation a unique id, a summary, the key and every path parameter", () => {
    const doc = build();
    const ids = new Set<string>();
    for (const route of API_REGISTRY) {
      const op = doc.paths[route.path]?.[route.method.toLowerCase()];
      expect(op, routeKey(route)).toBeDefined();
      expect(op?.summary).toBe(route.summary);
      expect(op?.security).toEqual([{ bearerAuth: [] }]);
      const declared = ((op?.parameters ?? []) as { name: string }[]).map((p) => p.name);
      expect(declared, routeKey(route)).toEqual([...pathParams(route.path)]);
      ids.add(String(op?.operationId));
    }
    expect(ids.size).toBe(API_REGISTRY.length);
  });

  it("has no dangling reference and documents 401, 429 with Retry-After and 404 for owned things", () => {
    const doc = build();
    expect(dangling(doc)).toEqual([]);
    expect(doc.components.responses.RateLimited?.headers).toHaveProperty("Retry-After");
    const take = doc.paths["/api/takes/{id}"]?.get;
    expect(Object.keys((take?.responses ?? {}) as object).sort()).toEqual([
      "2XX",
      "401",
      "404",
      "429",
    ]);
    expect(Object.keys((doc.paths["/api/usage"]?.get?.responses ?? {}) as object).sort()).toEqual([
      "2XX",
      "401",
      "429",
    ]);
  });

  it("leaves schemas out until the lookup has them, then adds them from zod", () => {
    const entry = (extra: Partial<ApiRoute>): ApiRoute => ({
      method: "POST",
      path: "/api/things",
      auth: "session-or-key",
      summary: "Make a thing.",
      ...extra,
    });
    const without = build({ registry: [entry({ request: "NewThing", response: "Thing" })] });
    expect(without.paths["/api/things"]?.post).not.toHaveProperty("requestBody");

    const schemas = (name: string) =>
      name === "NewThing"
        ? z.object({ name: z.string().min(1) })
        : name === "Thing"
          ? z.object({ id: z.string() })
          : undefined;
    const withSchemas = build({
      registry: [entry({ request: "NewThing", response: "Thing" })],
      schemas,
    });
    const op = withSchemas.paths["/api/things"]?.post as {
      requestBody: {
        content: { "application/json": { schema: { properties: object; $schema?: string } } };
      };
      responses: Record<
        string,
        { content: { "application/json": { schema: { properties: object } } } }
      >;
    };
    expect(op.requestBody.content["application/json"].schema.properties).toHaveProperty("name");
    expect(op.requestBody.content["application/json"].schema.$schema).toBeUndefined();
    expect(op.responses["2XX"]?.content["application/json"].schema.properties).toHaveProperty("id");
  });

  it("turns a request schema on a GET into query parameters with their required flags", () => {
    const doc = build({
      registry: [
        {
          method: "GET",
          path: "/api/takes/{id}/media",
          auth: "session-or-key",
          summary: "media",
          request: "MediaQuery",
        },
      ],
      schemas: (name) =>
        name === "MediaQuery"
          ? z.object({
              kind: z.enum(["download", "preview"]),
              page: z.number().optional(),
              limit: z.number().default(20),
            })
          : undefined,
    });
    const op = doc.paths["/api/takes/{id}/media"]?.get as {
      parameters: { name: string; in: string; required: boolean }[];
      requestBody?: unknown;
    };
    expect(op.requestBody).toBeUndefined();
    expect(op.parameters.map((p) => [p.name, p.in, p.required])).toEqual([
      ["id", "path", true],
      ["kind", "query", true],
      ["page", "query", false],
      ["limit", "query", false],
    ]);
  });

  it("ignores a name the lookup does not know", () => {
    const doc = build({
      registry: [
        { method: "GET", path: "/api/x", auth: "session-or-key", summary: "x", response: "Nope" },
      ],
      schemas: () => undefined,
    });
    expect(doc.paths["/api/x"]?.get?.responses).not.toHaveProperty("2XX.content");
  });
});

describe("operationId and pathParams", () => {
  it("builds stable ids from method and path", () => {
    expect(operationId({ method: "GET", path: "/api/takes/{id}" })).toBe("get_takes_By_id");
    expect(operationId({ method: "PATCH", path: "/api/takes/{id}/transcript/edits/{index}" })).toBe(
      "patch_takes_By_id_transcript_edits_By_index",
    );
    expect(pathParams("/api/takes/{id}/jobs/{jobId}")).toEqual(["id", "jobId"]);
  });
});
