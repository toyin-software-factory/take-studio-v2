/** The check list of a pipeline run: every scenario records into it, the end of the run prints it. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { work } from "./harness";

export type Check = { scenario: string; check: string; ok: boolean; detail: string };
export const checks: Check[] = [];
export function check(scenario: string, name: string, ok: boolean, detail: unknown = "") {
  checks.push({
    scenario,
    check: name,
    ok,
    detail: typeof detail === "string" ? detail : JSON.stringify(detail),
  });
}

/** Print every check and the totals, save checks.json, and return the number that failed. */
export function report(): number {
  const width = Math.max(...checks.map((c) => c.scenario.length));
  for (const c of checks) {
    console.log(
      `${c.ok ? "✓" : "✗"} ${c.scenario.padEnd(width)}  ${c.check}${c.ok ? "" : `  →  ${c.detail}`}`,
    );
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(
    `\n${checks.length - failed} passed, ${failed} failed (${checks.length} checks). Logs: ${work}`,
  );
  writeFileSync(join(work, "checks.json"), JSON.stringify(checks, null, 1));
  return failed;
}
