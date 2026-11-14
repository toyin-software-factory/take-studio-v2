/**
 * `pnpm legal:drift` (spec 0015 AC-10): lists the files this branch changed that can alter what
 * the Privacy and Terms pages promise, when `src/lib/legal-facts.ts` was not changed too. /sync
 * runs it and reports the result; it never fails the build (exit 0), the flag is for a human.
 */
import { execFileSync } from "node:child_process";
import { legalDriftFlag } from "../src/lib/legal-facts";

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim();

const base: string | null = (() => {
  for (const ref of ["origin/main", "main"]) {
    try {
      return git("merge-base", ref, "HEAD");
    } catch {
      /* try the next ref */
    }
  }
  return null;
})();

// No main reference: a diff against HEAD would miss every committed change, so say so instead of
// printing a clean result. Still exit 0 (advisory).
if (base === null) {
  console.log(
    "legal drift: could not check, neither origin/main nor main exists here. Run `git fetch origin main` and try again.",
  );
  process.exit(0);
}

const changed = new Set([
  ...git("diff", "--name-only", "--no-renames", base).split("\n"),
  ...git("ls-files", "--others", "--exclude-standard").split("\n"),
]);
changed.delete("");

const flagged = legalDriftFlag([...changed]);
if (flagged.length === 0) {
  console.log("legal drift: nothing flagged");
} else {
  console.log(
    `legal drift: these files can change what the Privacy and Terms pages promise, but src/lib/legal-facts.ts was not changed:\n${flagged.map((f) => `  - ${f}`).join("\n")}\nCheck the change list in src/lib/AGENTS.md, then update legal-facts.ts, the copy and the LEGAL_VERSION date (or say why no change is needed).`,
  );
}
