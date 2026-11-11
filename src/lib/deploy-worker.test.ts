import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Runs the real scripts/deploy-worker.sh with stand ins for `pnpm exec wrangler`, `sentry-cli`
 * and `tsx` (a fake `pnpm` first on PATH), to show its safety checks fire in a real deploy and
 * that the two phases keep their promise: `build` ships nothing and leaves a verified bundle,
 * `ship` deploys exactly that bundle (spec 0001 deploy order, spec 0005 AC-6).
 */

const script = resolve(__dirname, "../../scripts/deploy-worker.sh");

// The fake `pnpm`: a dry run writes the prepared bundle and map; `FAKE_FAIL` makes any tool call
// whose arguments contain that text fail; everything is logged.
const fakePnpm = `#!/usr/bin/env bash
[ "$1" = exec ] && shift
tool="$1"; shift
echo "$tool $*" >> "$FAKE_LOG"
if [ -n "\${FAKE_FAIL:-}" ] && [[ " $tool $* " == *"$FAKE_FAIL"* ]]; then
  echo "fake failure: $FAKE_FAIL" >&2
  exit 1
fi
if [ "$tool" = wrangler ] && [[ " $* " == *" --dry-run "* ]]; then
  while [ $# -gt 0 ]; do [ "$1" = --outdir ] && outdir="$2"; shift; done
  mkdir -p "$outdir"
  printf '%s' "$FAKE_BUNDLE" > "$outdir/worker.js"
  printf '%s' "$FAKE_MAP" > "$outdir/worker.js.map"
fi
if [ "$tool" = tsx ] && [[ "$1" == *worker-deploy-config.ts ]]; then
  echo '{}' > "$2/wrangler.json"
fi
exit 0
`;

type Run = { readonly status: number | null; readonly stderr: string; readonly log: string };

/** A workspace (like the CI job's checkout) that several script runs share, as build and ship do. */
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "deploy-worker-"));
  const bin = join(dir, "bin");
  const log = join(dir, "log.txt");
  mkdirSync(bin);
  writeFileSync(join(bin, "pnpm"), fakePnpm);
  chmodSync(join(bin, "pnpm"), 0o755);
  writeFileSync(log, "");
  return {
    dir,
    has: (path: string) => existsSync(join(dir, path)),
    run(
      mode: "build" | "ship",
      options: {
        readonly map?: string;
        readonly bundle?: string;
        readonly token?: string;
        readonly fail?: string;
      } = {},
    ): Run {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FAKE_LOG: log,
        FAKE_BUNDLE: options.bundle ?? "console.log(1);\n//# sourceMappingURL=worker.js.map\n",
        FAKE_MAP: options.map ?? withSources,
        ...(options.token ? { SENTRY_AUTH_TOKEN: options.token } : {}),
        ...(options.fail ? { FAKE_FAIL: options.fail } : {}),
      };
      const result = spawnSync("bash", [script, mode, "production", "abc123"], {
        cwd: dir,
        encoding: "utf8",
        env,
      });
      const full = readFileSync(log, "utf8");
      return { status: result.status, stderr: result.stderr, log: full };
    },
  };
}

const withSources = JSON.stringify({ version: 3, sources: ["../../src/app/api/x/route.ts"] });
const withoutSources = JSON.stringify({ version: 3, sources: ["../../node_modules/a/index.js"] });
const deployed = /wrangler deploy --config .*--no-bundle/;

describe("scripts/deploy-worker.sh build phase", () => {
  it("builds and checks the bundle, uploads the map, and ships nothing", () => {
    const w = workspace();
    const run = w.run("build", { token: "token" });
    expect(run.status).toBe(0);
    expect(run.log).toMatch(/sourcemaps inject/);
    expect(run.log).toMatch(/sourcemaps upload --release abc123/);
    expect(run.log).not.toMatch(deployed);
    expect(w.has(".wrangler-dist/worker.js")).toBe(true);
    expect(w.has(".wrangler-dist/wrangler.json")).toBe(true);
    expect(w.has(".wrangler-dist/worker.js.map")).toBe(false);
  });

  it("stops when the final map lists no src/ sources: no upload, nothing left to ship", () => {
    const w = workspace();
    const run = w.run("build", { map: withoutSources, token: "token" });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/lists no src\/ sources/);
    expect(run.log).not.toMatch(/sourcemaps upload/);
    expect(w.has(".wrangler-dist")).toBe(false);
  });

  it("stops when the map upload fails, and leaves no bundle behind", () => {
    const w = workspace();
    const run = w.run("build", { token: "token", fail: "sourcemaps upload" });
    expect(run.status).not.toBe(0);
    expect(w.has(".wrangler-dist")).toBe(false);
    expect(run.log).not.toMatch(deployed);
  });

  it("stops when the Worker build (the wrangler dry run) fails", () => {
    const w = workspace();
    const run = w.run("build", { token: "token", fail: "--dry-run" });
    expect(run.status).not.toBe(0);
    expect(run.log).not.toMatch(/sentry-cli/);
    expect(w.has(".wrangler-dist")).toBe(false);
  });

  it("refuses a bundle that still carries an inline map, with or without a token", () => {
    const bundle = "console.log(1);\n//# sourceMappingURL=data:application/json;base64,e30=\n";
    for (const token of [undefined, "token"]) {
      const w = workspace();
      const run = w.run("build", { bundle, ...(token ? { token } : {}) });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/inline source map/);
      expect(w.has(".wrangler-dist")).toBe(false);
    }
  });

  it("without a Sentry token it skips the Sentry steps and still builds", () => {
    const w = workspace();
    const run = w.run("build", { map: withoutSources });
    expect(run.status).toBe(0);
    expect(run.log).not.toMatch(/sentry-cli/);
    expect(w.has(".wrangler-dist/wrangler.json")).toBe(true);
  });
});

describe("scripts/deploy-worker.sh ship phase", () => {
  it("deploys exactly the bundle the build phase left", () => {
    const w = workspace();
    expect(w.run("build", { token: "token" }).status).toBe(0);
    const run = w.run("ship");
    expect(run.status).toBe(0);
    expect(run.log).toMatch(deployed);
    // Ship builds nothing and uploads nothing: it only deploys.
    expect(run.log.split("\n").filter((l) => /--dry-run|sourcemaps/.test(l))).toHaveLength(3);
  });

  it("keeps the bundle when the deploy itself fails, so ship can be retried", () => {
    const w = workspace();
    expect(w.run("build", { token: "token" }).status).toBe(0);
    const failed = w.run("ship", { fail: "wrangler deploy --config" });
    expect(failed.status).not.toBe(0);
    expect(w.has(".wrangler-dist/worker.js")).toBe(true);
    const retry = w.run("ship");
    expect(retry.status).toBe(0);
    expect(retry.log.match(/wrangler deploy --config/g) ?? []).toHaveLength(2);
  });

  it("removes the bundle once it has shipped, so it cannot be deployed twice by mistake", () => {
    const w = workspace();
    expect(w.run("build", { token: "token" }).status).toBe(0);
    expect(w.run("ship").status).toBe(0);
    expect(w.has(".wrangler-dist")).toBe(false);
    expect(w.run("ship").status).toBe(1);
  });

  it("refuses when there was no build", () => {
    const w = workspace();
    const run = w.run("ship");
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/run the build phase first/);
    expect(run.log).not.toMatch(deployed);
  });

  it("refuses when a failed build left nothing, so a failed build cannot ship an old bundle", () => {
    const w = workspace();
    expect(w.run("build", { token: "token", fail: "sourcemaps upload" }).status).not.toBe(0);
    const run = w.run("ship");
    expect(run.status).toBe(1);
    expect(run.log).not.toMatch(deployed);
  });
});
