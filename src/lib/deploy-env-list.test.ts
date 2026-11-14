import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emailEnvSchema,
  jobEnvSchema,
  transcriptEnvSchema,
  usageEnvSchema,
  webEnvSchema,
} from "./env";

/**
 * HRF-T05: the deploy preflight lists every Worker secret the site needs, so a deploy stops
 * before production changes when one is missing. The list must equal the env schemas the Worker
 * parses (web, usage, email); an optional name may only warn.
 */
const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
const names = (variable: string): string[] => {
  const match = workflow.match(new RegExp(`^\\s+${variable}="([^"]*)"`, "m"));
  expect(match, `deploy.yml sets ${variable}`).not.toBeNull();
  return match![1]!.split(/\s+/).filter(Boolean);
};

describe("deploy preflight secret list", () => {
  it("requires every name in the web, usage and email env schemas", () => {
    const fromSchemas = new Set([
      ...Object.keys(webEnvSchema.shape),
      ...Object.keys(usageEnvSchema.shape),
      ...Object.keys(emailEnvSchema.shape),
    ]);
    expect(new Set(names("required"))).toEqual(fromSchemas);
    expect(names("required")).toHaveLength(fromSchemas.size);
    for (const name of ["USAGE_HASH_SECRET", "EMAIL_LINK_SECRET", "RESEND_API_KEY", "EMAIL_FROM"]) {
      expect(names("required")).toContain(name);
    }
  });

  it("only warns for optional names, and a missing required one skips the deploy", () => {
    expect(names("optional")).toEqual(["SENTRY_DSN", "INSIGHTS_VIEWER_USER_ID"]);
    expect(names("optional").filter((n) => names("required").includes(n))).toEqual([]);
    expect(workflow).toContain('skip "Missing Worker secrets on take-studio:$missing"');
    expect(workflow).toMatch(/for name in \$optional; do[\s\S]*?::warning::Optional Worker secret/);
  });

  it("requires every job secret on Trigger.dev Prod: the job, usage and email schemas plus Deepgram (RF3-T06)", () => {
    const fromSchemas = new Set([
      ...Object.keys(jobEnvSchema.shape),
      ...Object.keys(usageEnvSchema.shape),
      ...Object.keys(emailEnvSchema.shape),
      ...Object.keys(transcriptEnvSchema.shape),
    ]);
    expect(new Set(names("trigger_required"))).toEqual(fromSchemas);
    expect(names("trigger_required")).toHaveLength(fromSchemas.size);
    expect(names("trigger_required")).toContain("DEEPGRAM_API_KEY");
    expect(names("trigger_optional")).toEqual(["SENTRY_DSN"]);
  });

  it("stops the deploy on a missing Trigger.dev name, warns on optional ones and never prints values", () => {
    expect(workflow).toContain('skip "Missing Trigger.dev Prod env vars:$missing"');
    expect(workflow).toContain("::warning::Optional Trigger.dev Prod env var $name");
    expect(workflow).toContain("api.trigger.dev/api/v1/projects/$ref/envvars/prod");
    // The check runs before the job reports ready, and the response is only read through jq on names.
    expect(workflow.indexOf("trigger_required=")).toBeLessThan(
      workflow.indexOf('echo "ready=true"'),
    );
    const check = workflow.slice(
      workflow.indexOf("ref=$(sed"),
      workflow.indexOf('echo "ready=true"'),
    );
    expect(check).not.toMatch(/echo "\$vars"(?! \|)/);
    expect(check).not.toMatch(/-v\b|--verbose|set -x/);
  });
});
