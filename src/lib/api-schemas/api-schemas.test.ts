import { describe, expect, it } from "vitest";
import { z } from "zod";
import { API_REGISTRY, routeKey } from "../api-registry";
import { buildOpenApi } from "../api-openapi";
import { API_SCHEMAS, apiSchema } from ".";
import { describeSchema } from "./describe";

type Operation = {
  requestBody?: { content: { "application/json": { schema: unknown } } };
  parameters?: { name: string; in: string }[];
  responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
};
type Doc = { paths: Record<string, Record<string, Operation>>; components: unknown };

const doc = buildOpenApi({ schemas: apiSchema }) as unknown as Doc;
const operationOf = (r: (typeof API_REGISTRY)[number]) =>
  doc.paths[r.path]?.[r.method.toLowerCase()] as Operation;

/** Body routes that take no JSON body: the id in the path is the whole request. */
const NO_REQUEST = new Set([
  "POST /api/takes/{id}/retry",
  "POST /api/takes/{id}/transcript",
  "POST /api/backgrounds/{id}/complete",
]);

describe("API schemas cover the registry (spec 0018 AC-11)", () => {
  it("every route names a response, or says it answers with no body", () => {
    const missing = API_REGISTRY.filter((r) => !r.noContent && !r.response).map(routeKey);
    expect(missing).toEqual([]);
  });

  it("a route that answers with no body names no response", () => {
    expect(API_REGISTRY.filter((r) => r.noContent && r.response).map(routeKey)).toEqual([]);
  });

  it("every route that reads a body or a query names a request", () => {
    const takesInput = API_REGISTRY.filter((r) => ["POST", "PUT", "PATCH"].includes(r.method));
    const missing = takesInput.filter((r) => !r.request && !NO_REQUEST.has(routeKey(r)));
    expect(missing.map(routeKey)).toEqual([]);
    expect(
      API_REGISTRY.filter((r) => r.request && NO_REQUEST.has(routeKey(r))).map(routeKey),
    ).toEqual([]);
  });

  it("every name a route uses has a schema, and every schema is used", () => {
    const used = new Set(API_REGISTRY.flatMap((r) => [r.request, r.response]).filter(Boolean));
    expect([...used].filter((name) => !apiSchema(name as string))).toEqual([]);
    expect(Object.keys(API_SCHEMAS).filter((name) => !used.has(name))).toEqual([]);
  });

  it("every schema turns into JSON Schema", () => {
    for (const [name, schema] of Object.entries(API_SCHEMAS)) {
      expect(() => z.toJSONSchema(schema, { io: "input" }), name).not.toThrow();
      expect(() => z.toJSONSchema(schema, { io: "output" }), name).not.toThrow();
    }
  });
});

describe("/api/openapi.json carries the schemas", () => {
  it("every operation has its success answer, and a body or query for its request", () => {
    for (const r of API_REGISTRY) {
      const op = operationOf(r);
      const key = r.noContent ? "204" : "2XX";
      expect(op.responses[key], routeKey(r)).toBeDefined();
      if (r.noContent) expect(op.responses[key]?.content).toBeUndefined();
      else {
        const types = r.text
          ? ["text/plain", "application/x-subrip", "text/vtt"]
          : ["application/json"];
        for (const type of types) {
          expect(op.responses[key]?.content?.[type]?.schema, routeKey(r)).toBeDefined();
        }
      }
      if (r.request && r.method !== "GET") {
        expect(op.requestBody?.content["application/json"].schema, routeKey(r)).toBeDefined();
      }
      if (r.request && r.method === "GET") {
        expect(
          op.parameters?.some((p) => p.in === "query"),
          routeKey(r),
        ).toBe(true);
      }
    }
  });

  it("is JSON and has no dangling reference", () => {
    const text = JSON.stringify(doc);
    expect(JSON.parse(text)).toEqual(doc);
    const refs = [...text.matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1] ?? "");
    const dangling = refs.filter((ref) => {
      let at: unknown = doc;
      for (const part of ref.split("/")) at = (at as Record<string, unknown> | undefined)?.[part];
      return at === undefined;
    });
    expect(dangling).toEqual([]);
  });
});

describe("describeSchema", () => {
  it("lists nested and list fields with required and notes", () => {
    const rows = describeSchema(apiSchema("TakeDetail") as z.ZodType, "output");
    const byPath = new Map(rows.map((row) => [row.path, row]));
    expect(byPath.get("take.id")).toMatchObject({ type: "string", required: true });
    expect(byPath.get("take.status")?.note).toContain('"ready"');
    expect(byPath.get("cuts")?.type).toBe("object list");
    expect(byPath.get("cuts[].startMs")?.type).toBe("number");
  });

  it("marks a left out request field optional", () => {
    const rows = describeSchema(apiSchema("UploadCreateRequest") as z.ZodType, "input");
    expect(rows.find((row) => row.path === "script")?.required).toBe(false);
    expect(rows.find((row) => row.path === "fileName")?.required).toBe(true);
  });

  it("keeps every alternative of a union and the null of a nested object", () => {
    const change = describeSchema(apiSchema("BackgroundChangeRequest") as z.ZodType, "input");
    expect(change.find((r) => r.note.includes('"original"'))?.note).toContain("uuid");
    const detail = describeSchema(apiSchema("TakeDetail") as z.ZodType, "output");
    expect(detail.find((r) => r.path === "latestJob")?.type).toMatch(/ or null$/);
  });

  it("documents the upload length hint and the media kind", () => {
    const upload = describeSchema(apiSchema("UploadCreateRequest") as z.ZodType, "input");
    expect(upload.find((r) => r.path === "durationHintMs")?.required).toBe(false);
    const media = describeSchema(apiSchema("MediaQuery") as z.ZodType, "input");
    expect(media.find((r) => r.path === "kind")?.note).toContain('"download"');
  });

  it("gives a text file no fields", () => {
    expect(describeSchema(apiSchema("TranscriptFile") as z.ZodType, "output")).toEqual([]);
  });
});
