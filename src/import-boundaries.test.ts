import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The code boundary from spec 0001 (Runtime rules, scaffold checklist item 10), enforced by
 * `no-restricted-imports` in eslint.config.mjs. Lints source text as if it lived at a given
 * path, using the project's real ESLint config.
 */
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

/** The `no-restricted-imports` messages for `code` placed at `filePath`. */
async function boundaryErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

describe("import boundaries (spec 0001)", { timeout: 60_000 }, () => {
  it("stops jobs from importing web app code", async () => {
    const errors = await boundaryErrors(
      "src/trigger/example.ts",
      'import { getDb } from "@/server/request";\nimport { GET } from "@/app/api/health/route";\nexport const x = [getDb, GET];\n',
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Jobs import only from src/db, src/lib and src/trigger");
  });

  it("lets jobs import shared db and lib code", async () => {
    expect(
      await boundaryErrors(
        "src/trigger/example.ts",
        'import { withJobDb } from "@/db/client/job";\nimport { parseJobEnv } from "@/lib/env";\nexport const x = [withJobDb, parseJobEnv];\n',
      ),
    ).toEqual([]);
  });

  it("stops the web app from importing task code or heavy SDKs", async () => {
    const errors = await boundaryErrors(
      "src/server/example.ts",
      'import { helloTask } from "@/trigger/hello";\nimport Anthropic from "@anthropic-ai/sdk";\nexport const x = [helloTask, Anthropic];\n',
    );
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toContain("Heavy SDKs belong in src/trigger jobs");
  });

  it("lets the web app import task types only (for tasks.trigger)", async () => {
    expect(
      await boundaryErrors(
        "src/app/example.ts",
        'import type { helloTask } from "@/trigger/hello";\nexport type T = typeof helloTask;\n',
      ),
    ).toEqual([]);
  });

  it("stops shared db and lib code from depending on the web app or jobs", async () => {
    const errors = await boundaryErrors(
      "src/lib/example.ts",
      'import { getDb } from "@/server/request";\nimport { cleanupTask } from "@/trigger/cleanup";\nexport const x = [getDb, cleanupTask];\n',
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Shared code (src/db, src/lib) must not depend");
  });
});
