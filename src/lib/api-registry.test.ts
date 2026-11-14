import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  API_EXCLUSIONS,
  API_METHODS,
  API_REGISTRY,
  routeKey,
  type ApiMethod,
} from "./api-registry";

/** The API registry covers every route (spec 0018 AC-8). */

const API_DIR = join(process.cwd(), "src", "app", "api");

/**
 * Exclusions whose route file has not landed on this branch yet: `keys` (step 2) and
 * `openapi.json` (step 6). Delete an entry here when its route exists; the staleness check below
 * then covers it.
 */
const NOT_BUILT_YET: ReadonlySet<string> = new Set([
  "GET /api/keys",
  "POST /api/keys",
  "DELETE /api/keys/{id}",
  "GET /api/openapi.json",
]);

function routeFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** `src/app/api/takes/[id]/route.ts` is `/api/takes/{id}`; `[...all]` is `{...all}`. */
function routePath(file: string): string {
  const folders = relative(API_DIR, file).split(sep).slice(0, -1);
  return `/api/${folders.map((f) => f.replace(/^\[(.+)\]$/, "{$1}")).join("/")}`.replace(/\/$/, "");
}

/**
 * Every HTTP method a route file exports, read from the syntax tree so comments and strings are
 * ignored: functions, every declarator of a `const`/`let`, and `export { x as GET }` (with or
 * without a `from`). `export *` hides its names, so it is refused rather than guessed.
 */
export function exportedMethods(source: string): readonly ApiMethod[] {
  const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const exported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && exported(node) && node.name) {
      found.add(node.name.text);
    } else if (ts.isVariableStatement(node) && exported(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) found.add(d.name.text);
      }
    } else if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) throw new Error("export * in a route file hides its methods");
      if (ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) found.add(el.name.text);
      }
    }
  }
  return API_METHODS.filter((method) => found.has(method));
}

const actual: readonly string[] = routeFiles(API_DIR).flatMap((file) =>
  exportedMethods(readFileSync(file, "utf8")).map((method) =>
    routeKey({ method, path: routePath(file) }),
  ),
);

const registered = API_REGISTRY.map(routeKey);
const excluded = API_EXCLUSIONS.map(routeKey);

describe("exportedMethods", () => {
  it("reads declarations, consts and re-exports, and ignores other exports", () => {
    expect(exportedMethods("export async function GET() {}\nexport function POST() {}")).toEqual([
      "GET",
      "POST",
    ]);
    expect(exportedMethods("export const DELETE = () => {};\nexport const dynamic = 'x';")).toEqual(
      ["DELETE"],
    );
    expect(exportedMethods("export { handle as GET, handle as POST };")).toEqual(["GET", "POST"]);
    expect(exportedMethods("function GET() {}\nexport const runtime = 'edge';")).toEqual([]);
  });

  it("reads every declarator of one const, HEAD and OPTIONS, and re-exports", () => {
    expect(exportedMethods("export const GET = a, POST = b;")).toEqual(["GET", "POST"]);
    expect(
      exportedMethods("export function HEAD() {}\nexport async function OPTIONS() {}"),
    ).toEqual(["HEAD", "OPTIONS"]);
    expect(exportedMethods("export { GET, PUT as PATCH } from './x';")).toEqual(["GET", "PATCH"]);
  });

  it("ignores commented out and quoted exports", () => {
    const source = [
      "// export const POST = handler;",
      "/* export function DELETE() {} */",
      "const text = 'export const PUT = 1';",
      "export function GET() {}",
    ].join("\n");
    expect(exportedMethods(source)).toEqual(["GET"]);
  });

  it("refuses export * because it hides the methods", () => {
    expect(() => exportedMethods("export * from './handlers';")).toThrow(/export \*/);
  });
});

describe("api registry coverage (spec 0018 AC-8)", () => {
  it("finds the routes (the walk is not silently empty)", () => {
    expect(actual).toContain("GET /api/takes/{id}");
    expect(actual).toContain("DELETE /api/takes/{id}");
    expect(actual).toContain("POST /api/auth/{...all}");
    expect(actual.length).toBeGreaterThan(20);
  });

  it("has every exported method of every route.ts in the registry or the exclusions", () => {
    const missing = actual.filter((key) => !registered.includes(key) && !excluded.includes(key));
    expect(
      missing,
      "add each to API_REGISTRY or API_EXCLUSIONS in src/lib/api-registry.ts",
    ).toEqual([]);
  });

  it("lists no route twice, and none as both public and excluded", () => {
    const all = [...registered, ...excluded];
    expect(all.filter((key, i) => all.indexOf(key) !== i)).toEqual([]);
  });

  it("has no registry entry without a real route", () => {
    expect(registered.filter((key) => !actual.includes(key))).toEqual([]);
  });

  it("has no exclusion without a real route, except the ones not built yet", () => {
    expect(excluded.filter((key) => !actual.includes(key) && !NOT_BUILT_YET.has(key))).toEqual([]);
  });

  it("keeps sign in, delete account and key management out of the public list", () => {
    for (const entry of API_REGISTRY) {
      expect(entry.path.startsWith("/api/auth/"), entry.path).toBe(false);
      expect(entry.path.startsWith("/api/keys"), entry.path).toBe(false);
    }
    const byKey = new Map(API_EXCLUSIONS.map((e) => [routeKey(e), e.reason]));
    expect(byKey.get("POST /api/keys")).toBe("session-only");
    expect(byKey.get("DELETE /api/keys/{id}")).toBe("session-only");
    expect(byKey.get("POST /api/auth/{...all}")).toBe("auth");
  });

  it("keeps account email preferences public (spec 0018 AC-8)", () => {
    expect(registered).toContain("GET /api/account/email-prefs");
    expect(registered).toContain("PATCH /api/account/email-prefs");
  });

  it("gives every entry a summary or a note, and a path that starts with /api/", () => {
    for (const entry of API_REGISTRY) {
      expect(entry.summary.trim().length, routeKey(entry)).toBeGreaterThan(0);
      expect(entry.path.startsWith("/api/"), entry.path).toBe(true);
    }
    for (const entry of API_EXCLUSIONS) {
      expect(entry.note.trim().length, routeKey(entry)).toBeGreaterThan(0);
    }
  });
});
