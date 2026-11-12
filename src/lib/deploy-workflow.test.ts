import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The order of the production deploy (spec 0001): everything that can fail without touching
 * production runs first, and the only step that changes the live Worker is the last one.
 */
const workflow = readFileSync(resolve(__dirname, "../../.github/workflows/deploy.yml"), "utf8");
const at = (text: string) => {
  const index = workflow.indexOf(text);
  expect(index, `deploy.yml should contain "${text}"`).toBeGreaterThan(-1);
  return index;
};

const code = workflow.replace(/^\s*#.*$/gm, "");

describe("deploy.yml gate (HRF-T04)", () => {
  it("starts from the CI workflow finishing on main, not from a push", () => {
    expect(code).toMatch(
      /^on:\s*\n\s+workflow_run:\s*\n\s+workflows: \[CI\]\s*\n\s+types: \[completed\]\s*\n\s+branches: \[main\]/m,
    );
    expect(code).not.toMatch(/^\s+push:/m);
    // A manual run stays possible.
    expect(code).toMatch(/^\s+workflow_dispatch:/m);
  });

  it("deploys only after a successful push run of CI on main", () => {
    const first = code.slice(code.indexOf("preflight:"), code.indexOf("outputs:"));
    expect(first).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(first).toContain("github.event.workflow_run.event == 'push'");
    expect(first).toContain("github.event.workflow_run.head_branch == 'main'");
    // The deploy job waits for the gate through preflight.
    expect(code).toMatch(/deploy:[\s\S]*?needs: preflight/);
  });

  it("checks out and releases the commit CI tested, never the newest main", () => {
    expect(code).toContain("DEPLOY_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}");
    const checkouts =
      code.match(
        /uses: actions\/checkout@v5\s*\n\s+with:\s*\n\s+ref: \$\{\{ env\.DEPLOY_SHA \}\}/g,
      ) ?? [];
    expect(checkouts).toHaveLength(code.match(/uses: actions\/checkout@/g)?.length ?? -1);
    // `github.sha` appears once, as the manual run fallback: no release or build uses it.
    expect(code.match(/github\.sha/g) ?? []).toHaveLength(1);
  });

  it("keeps one deploy at a time on the deploy job, so a skipped run never joins the group", () => {
    // Not on the workflow: a failed CI run would take the waiting slot and then be skipped.
    expect(code).not.toMatch(/^concurrency:/m);
    const job = code.slice(code.indexOf("\n  deploy:"));
    expect(job).toMatch(
      /concurrency:\s*\n\s+group: deploy-production\s*\n\s+cancel-in-progress: false/,
    );
    expect(job.indexOf("concurrency:")).toBeLessThan(job.indexOf("steps:"));
  });

  it("deploys an automated run only while its commit is the tip of main, before any production write", () => {
    const order = at("- id: order");
    expect(order).toBeLessThan(at("pnpm run deploy:build"));
    expect(code).toContain('"$GITHUB_EVENT_NAME" = "workflow_run"');
    expect(code).toContain("git ls-remote origin refs/heads/main");
    expect(code).toContain('[ "$tip" != "$DEPLOY_SHA" ]');
    // Every step after the check (installs and the four phases) honours it.
    for (const text of [
      "pnpm/action-setup@v4",
      "pnpm install --frozen-lockfile",
      "pnpm run deploy:build",
      "pnpm db:migrate",
      "pnpm deploy:trigger",
      "pnpm run deploy:ship",
    ]) {
      const index = code.indexOf(text);
      expect(index, text).toBeGreaterThan(-1);
      const from = code.lastIndexOf("\n      - ", index);
      const next = code.indexOf("\n      - ", index);
      const stepText = code.slice(from, next === -1 ? undefined : next);
      expect(stepText, text).toContain("steps.order.outputs.stale != 'true'");
    }
  });

  it("needs no write access to the repository", () => {
    expect(code).not.toMatch(/contents: write/);
    expect(code.match(/^permissions:\s*\n\s+contents: read/m)).not.toBeNull();
  });
});

describe("deploy.yml order", () => {
  it("builds and checks the Worker, then migrates, then deploys the jobs, then ships the Worker", () => {
    const build = at("pnpm run deploy:build");
    const migrate = at("pnpm db:migrate");
    const jobs = at("pnpm deploy:trigger");
    const ship = at("pnpm run deploy:ship");
    expect(build).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(jobs);
    expect(jobs).toBeLessThan(ship);
  });

  it("only the last step ships the Worker", () => {
    expect(workflow.match(/wrangler deploy/g) ?? []).toHaveLength(0);
    expect(workflow.match(/deploy:ship/g) ?? []).toHaveLength(1);
    // Nothing runs after the ship step.
    const afterShip = workflow.slice(workflow.indexOf("deploy:ship"));
    expect(afterShip.match(/^\s+- (name|run|uses):/gm) ?? []).toHaveLength(0);
  });

  it("the package scripts keep the phases apart and `deploy` runs both in order", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["deploy:build"]).toMatch(/deploy-worker\.sh build /);
    expect(pkg.scripts["deploy:ship"]).toMatch(/deploy-worker\.sh ship /);
    expect(pkg.scripts["deploy:build"]).not.toMatch(/ship/);
    // The old bundle goes before the first command that can fail (check-env, OpenNext), so a
    // failed build can never leave a bundle from an earlier build for `deploy:ship` to deploy.
    expect(pkg.scripts["deploy:build"]).toMatch(/^rm -rf \.wrangler-dist && /);
    expect(pkg.scripts["deploy"]).toBe("pnpm run deploy:build && pnpm run deploy:ship");
  });
});
