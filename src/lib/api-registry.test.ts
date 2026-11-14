import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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

/** Every HTTP method a route file exports: declarations, consts and `export { x as GET }`. */
export function exportedMethods(source: string): readonly ApiMethod[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/g)) {
    found.add(m[1] ?? "");
  }
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of (m[1] ?? "").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) found.add(name);
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
