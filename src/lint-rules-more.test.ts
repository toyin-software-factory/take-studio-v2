import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * B2-T133, rules that used to be prose in AGENTS.md. The first four are ESLint rules in
 * eslint.config.mjs (linted here as if the text lived at a given path); the last two are scans of
 * the source, because they are about which file calls a function.
 */
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

/** The messages of one rule for `code` placed at `filePath`. */
async function messages(rule: string, filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === rule).map((m) => m.message);
}

describe("named exports only", { timeout: 60_000 }, () => {
  const code = "export default function Thing() { return null; }\n";
  it("refuses a default export in a component or a lib file", async () => {
    for (const file of ["src/components/ui/thing.tsx", "src/lib/thing.ts", "src/server/thing.ts"])
      expect(await messages("import/no-default-export", file, code)).toHaveLength(1);
  });
  it("allows it where Next.js and the Worker require it", async () => {
    for (const file of [
      "src/app/page.tsx",
      "src/app/a/route.ts",
      "src/app/error.tsx",
      "src/worker.ts",
    ])
      expect(await messages("import/no-default-export", file, code)).toEqual([]);
  });
  it("allows named exports", async () => {
    expect(
      await messages("import/no-default-export", "src/lib/a.ts", "export const a = 1;\n"),
    ).toEqual([]);
  });
});

describe("error pages never show the raw error", { timeout: 60_000 }, () => {
  const code = "export function f(error: Error) { return error.message; }\n";
  it("refuses error.message on the two error pages, naming the fix", async () => {
    for (const file of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
      const found = await messages("no-restricted-properties", file, code);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("reportBrowserError");
    }
  });
  it("leaves other files alone, and the digest is fine", async () => {
    expect(await messages("no-restricted-properties", "src/lib/a.ts", code)).toEqual([]);
    const ok = "export const f = (error: Error & { digest?: string }) => error.digest;\n";
    expect(await messages("no-restricted-properties", "src/app/error.tsx", ok)).toEqual([]);
  });
});

describe("the browser reads through zod/mini only", { timeout: 60_000 }, () => {
  it("refuses full zod in a component, naming zod/mini", async () => {
    const found = await messages(
      "no-restricted-imports",
      "src/components/x/a.ts",
      'import { z } from "zod";\nexport const s = z.string();\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("zod/mini");
  });
  it("allows zod/mini, and full zod outside components", async () => {
    expect(
      await messages(
        "no-restricted-imports",
        "src/components/x/a.ts",
        'import * as z from "zod/mini";\nexport const s = z.string();\n',
      ),
    ).toEqual([]);
    expect(
      await messages(
        "no-restricted-imports",
        "src/lib/a.ts",
        'import { z } from "zod";\nexport const s = z.string();\n',
      ),
    ).toEqual([]);
  });
});

describe("browser calls go through callApi", { timeout: 60_000 }, () => {
  const code = 'export const go = () => fetch("/api/x");\n';
  it("refuses window.fetch and globalThis.fetch too", async () => {
    for (const call of ["window.fetch", "globalThis.fetch"]) {
      const found = await messages(
        "no-restricted-properties",
        "src/components/takes/a.ts",
        `export const go = () => ${call}("/api/x");\n`,
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("callApi");
    }
  });
  it("refuses a bare fetch in a component, naming callApi", async () => {
    const found = await messages("no-restricted-globals", "src/components/takes/a.ts", code);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("callApi");
  });
  it("allows callApi, and fetch in the helper itself", async () => {
    const ok =
      'import { callApi } from "@/components/takes/browser-io";\nexport const go = () => callApi("/api/x", "GET");\n';
    expect(await messages("no-restricted-globals", "src/components/takes/a.ts", ok)).toEqual([]);
    expect(
      await messages("no-restricted-globals", "src/components/takes/browser-io.ts", code),
    ).toEqual([]);
  });
});

type Source = { readonly file: string; readonly text: string };

/** Files (other than `allowed`) whose text matches `pattern`. */
export function callsOutside(
  sources: readonly Source[],
  pattern: RegExp,
  allowed: readonly string[],
) {
  return sources
    .filter((s) => !allowed.includes(s.file) && pattern.test(s.text))
    .map((s) => s.file);
}

function sourcesUnder(dir: string): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [{ file: full.split(path.sep).join("/"), text: readFileSync(full, "utf8") }];
  });
}

// The name itself, so an import alias (`createWebDb as makeDb`) is caught too, and whitespace or
// line breaks between the parts of a call do not hide it.
const CREATE_WEB_DB = /\bcreateWebDb\b/;
const AUTH_GET_SESSION = /\.\s*api\s*\.\s*getSession\b/;
// A client kept at module level: a top of file `const x = getDb(...)` or `createWebDb(...)`.
const MODULE_LEVEL_DB =
  /^(?:export\s+)?(?:const|let|var)\s[^=\n]*=\s*(?:\(\s*|await\s+)*(?:getDb|createWebDb)\s*\(/m;
const CREATE_WEB_DB_HOMES = [
  "src/server/request.ts",
  "src/db/client/web.ts",
  "src/db/client/index.ts",
];
const GET_SESSION_HOMES = ["src/server/request.ts", "src/server/api-auth-deps.ts"];

describe("scans: where the database client and the session are made", () => {
  it("finds a call outside the allowed files, and none inside them", () => {
    const sources = [
      { file: "src/server/request.ts", text: "createWebDb(env)" },
      { file: "src/app/x/page.tsx", text: "const db = createWebDb(env);" },
      { file: "src/app/y/page.tsx", text: "await auth.api.getSession({ headers })" },
      {
        file: "src/app/z/page.tsx",
        text: 'import { createWebDb as makeDb } from "@/db/client/web";',
      },
      {
        file: "src/app/w/page.tsx",
        text: "(await getAuth())\n  .api\n  .getSession ({ headers })",
      },
      { file: "src/app/v/page.tsx", text: "const db = await getDb();\nexport default 1;" },
      { file: "src/app/u/page.tsx", text: "export const db = (await getDb());" },
    ];
    expect(callsOutside(sources, CREATE_WEB_DB, CREATE_WEB_DB_HOMES)).toEqual([
      "src/app/x/page.tsx",
      "src/app/z/page.tsx",
    ]);
    expect(callsOutside(sources, AUTH_GET_SESSION, GET_SESSION_HOMES)).toEqual([
      "src/app/y/page.tsx",
      "src/app/w/page.tsx",
    ]);
    expect(callsOutside(sources, MODULE_LEVEL_DB, [])).toEqual([
      "src/app/x/page.tsx",
      "src/app/v/page.tsx",
      "src/app/u/page.tsx",
    ]);
  });

  const real = sourcesUnder("src");
  it("only src/server/request.ts builds a web database client: use getDb() (src/db/AGENTS.md)", () => {
    expect(callsOutside(real, CREATE_WEB_DB, CREATE_WEB_DB_HOMES)).toEqual([]);
  });
  it("no file keeps a database client at module level: call getDb() inside the request", () => {
    expect(callsOutside(real, MODULE_LEVEL_DB, [])).toEqual([]);
  });
  it("only request.ts and api-auth-deps.ts read the session from Better Auth: pages use getSession()", () => {
    expect(callsOutside(real, AUTH_GET_SESSION, GET_SESSION_HOMES)).toEqual([]);
  });
});
