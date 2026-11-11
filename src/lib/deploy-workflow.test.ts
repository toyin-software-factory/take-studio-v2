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
