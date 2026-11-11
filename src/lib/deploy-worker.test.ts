import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Runs the real scripts/deploy-worker.sh with stand ins for `pnpm exec wrangler`, `sentry-cli`
 * and `tsx` (a fake `pnpm` first on PATH), to show its safety checks fire in a real deploy:
 * the deploy stops before uploading or deploying when the final map has no `src/` sources,
 * or when the bundle still carries an inline map (spec 0005, AC-6).
 */

const script = resolve(__dirname, "../../scripts/deploy-worker.sh");

// The fake `pnpm`: a dry run writes the prepared bundle and map, everything else is logged.
const fakePnpm = `#!/usr/bin/env bash
[ "$1" = exec ] && shift
tool="$1"; shift
echo "$tool $*" >> "$FAKE_LOG"
if [ "$tool" = wrangler ] && [[ " $* " == *" --dry-run "* ]]; then
  while [ $# -gt 0 ]; do [ "$1" = --outdir ] && outdir="$2"; shift; done
  mkdir -p "$outdir"
  printf '%s' "$FAKE_BUNDLE" > "$outdir/worker.js"
  printf '%s' "$FAKE_MAP" > "$outdir/worker.js.map"
fi
exit 0
`;

type Run = { readonly status: number | null; readonly stderr: string; readonly log: string };

function deploy(options: {
  readonly map: string;
  readonly bundle?: string;
  readonly token?: string;
}): Run {
  const dir = mkdtempSync(join(tmpdir(), "deploy-worker-"));
  const bin = join(dir, "bin");
  const log = join(dir, "log.txt");
  const pnpm = join(bin, "pnpm");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(pnpm, fakePnpm);
  chmodSync(pnpm, 0o755);
  writeFileSync(log, "");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_LOG: log,
    FAKE_BUNDLE: options.bundle ?? "console.log(1);\n//# sourceMappingURL=worker.js.map\n",
    FAKE_MAP: options.map,
    ...(options.token ? { SENTRY_AUTH_TOKEN: options.token } : {}),
  };
  const result = spawnSync("bash", [script, "production", "abc123"], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stderr: result.stderr,
    log: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

const withSources = JSON.stringify({ version: 3, sources: ["../../src/app/api/x/route.ts"] });
const withoutSources = JSON.stringify({ version: 3, sources: ["../../node_modules/a/index.js"] });

describe("scripts/deploy-worker.sh safety checks", () => {
  it("stops before uploading or deploying when the final map lists no src/ sources", () => {
    const run = deploy({ map: withoutSources, token: "token" });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/lists no src\/ sources/);
    expect(run.log).not.toMatch(/sourcemaps upload/);
    expect(run.log).not.toMatch(/wrangler deploy --config/);
  });

  it("uploads and deploys when the map lists src/ sources", () => {
    const run = deploy({ map: withSources, token: "token" });
    expect(run.status).toBe(0);
    expect(run.log).toMatch(/sourcemaps inject/);
    expect(run.log).toMatch(/sourcemaps upload --release abc123/);
    expect(run.log).toMatch(/wrangler deploy --config .*--no-bundle/);
  });

  it("refuses a bundle that still carries an inline map, with or without a token", () => {
    const bundle = "console.log(1);\n//# sourceMappingURL=data:application/json;base64,e30=\n";
    for (const token of [undefined, "token"]) {
      const run = deploy({ map: withSources, bundle, ...(token ? { token } : {}) });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/inline source map/);
      expect(run.log).not.toMatch(/wrangler deploy --config/);
    }
  });

  it("without a Sentry token it skips the source map steps and still deploys", () => {
    const run = deploy({ map: withoutSources });
    expect(run.status).toBe(0);
    expect(run.log).not.toMatch(/sentry-cli/);
    expect(run.log).toMatch(/wrangler deploy --config/);
  });
});
