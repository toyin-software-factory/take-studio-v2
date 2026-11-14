import { z } from "zod";

/**
 * A schema as a flat list of fields for the docs page: `take.id`, `cuts[].startMs`. Built from
 * zod 4's own JSON Schema, so the page and `/api/openapi.json` always agree. Pure.
 */

export type FieldRow = {
  readonly path: string;
  readonly type: string;
  readonly required: boolean;
  /** Allowed values, a limit or the format, when there is one. */
  readonly note: string;
};

type Json = { readonly [key: string]: unknown };

const asJson = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};

function typeOf(node: Json): string {
  if (Array.isArray(node.anyOf)) {
    const kinds = node.anyOf.map((n) => typeOf(asJson(n)));
    return [...new Set(kinds)].join(" or ");
  }
  if (Array.isArray(node.type)) return node.type.join(" or ");
  if (node.type === "array") return `${typeOf(asJson(node.items))} list`;
  if (typeof node.type === "string") return node.type;
  if ("const" in node) return typeof node.const;
  return "any";
}

function noteOf(node: Json): string {
  const notes: string[] = [];
  const values = Array.isArray(node.enum)
    ? node.enum
    : "const" in node
      ? [node.const]
      : Array.isArray(node.anyOf)
        ? node.anyOf.flatMap((n) => ("const" in asJson(n) ? [asJson(n).const] : []))
        : [];
  if (values.length > 0) notes.push(`one of ${values.map((v) => JSON.stringify(v)).join(", ")}`);
  if (typeof node.format === "string") notes.push(node.format);
  if (typeof node.minimum === "number") notes.push(`at least ${node.minimum}`);
  if (typeof node.maximum === "number") notes.push(`at most ${node.maximum}`);
  if (typeof node.minLength === "number") notes.push(`${node.minLength}+ characters`);
  if (typeof node.maxLength === "number") notes.push(`up to ${node.maxLength} characters`);
  if (typeof node.minItems === "number") notes.push(`at least ${node.minItems} items`);
  if (typeof node.maxItems === "number") notes.push(`at most ${node.maxItems} items`);
  return notes.join(", ");
}

function objectOf(node: Json): Json | null {
  if (node.type === "object" && node.properties) return node;
  if (node.type === "array") return objectOf(asJson(node.items));
  if (Array.isArray(node.anyOf)) {
    const found = node.anyOf.map((n) => objectOf(asJson(n))).find((n) => n !== null);
    return found ?? null;
  }
  return null;
}

function walk(node: Json, prefix: string): readonly FieldRow[] {
  const properties = asJson(node.properties);
  const required = Array.isArray(node.required) ? (node.required as readonly string[]) : [];
  return Object.entries(properties).flatMap(([name, raw]) => {
    const child = asJson(raw);
    const isList = child.type === "array";
    const path = prefix === "" ? name : `${prefix}.${name}`;
    const nested = objectOf(child);
    const row: FieldRow = {
      path,
      type: nested ? (isList ? "object list" : "object") : typeOf(child),
      required: required.includes(name),
      note: noteOf(child),
    };
    return nested ? [row, ...walk(nested, isList ? `${path}[]` : path)] : [row];
  });
}

/** The fields of `schema` as the API sends or takes them. `io` is `input` for a request. */
export function describeSchema(schema: z.ZodType, io: "input" | "output"): readonly FieldRow[] {
  const json = asJson(z.toJSONSchema(schema, { io }));
  if (json.type === "string") return [];
  return walk(objectOf(json) ?? json, "");
}
