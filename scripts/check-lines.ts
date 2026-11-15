/**
 * `pnpm check:lines` (B2-T122): no tracked source file goes past 250 lines. Lists every git
 * tracked .ts, .tsx, .js, .mjs and .css file over the limit (lines are counted like `wc -l`) and
 * exits 1 when there is one. With file arguments (the pre commit hook passes the staged files) it
 * checks only those. Generated files and a short list of exempt folders are skipped.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_LINES = 250;

const CHECKED = /\.(ts|tsx|js|mjs|css)$/;

/** Generated or vendored output: migrations and their meta, build folders, vendored agent skills (`.claude/skills/`). Lockfiles are not .ts, .js or .css, so CHECKED already skips them (a name match on "lock" would also skip clock.ts). */
const GENERATED = [/^drizzle\//, /(^|\/)\.next\//, /(^|\/)node_modules\//, /^\.claude\/skills\//];

/**
 * Folders kept out on purpose. `tools/design-check/` is a standalone dev tool that is not part
 * of the app and was never split; remove it from this list when it is.
 */
const EXEMPT = [/^tools\/design-check\//];

export type FileLines = { readonly path: string; readonly lines: number };

/** Lines the way `wc -l` counts them: the number of newline characters. */
export function countLines(text: string): number {
  let n = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n += 1;
  return n;
}

export function isChecked(path: string): boolean {
  return CHECKED.test(path) && ![...GENERATED, ...EXEMPT].some((pattern) => pattern.test(path));
}

/** The checked files over the limit, longest first. */
export function overLimit(files: readonly FileLines[], max: number = MAX_LINES): FileLines[] {
  return files
    .filter((f) => isChecked(f.path) && f.lines > max)
    .toSorted((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((path) => path !== "");
}

function main(args: readonly string[]): number {
  // lint-staged passes absolute paths; the skip lists are written against repo relative ones.
  const given = args.map((path) => relative(process.cwd(), path));
  const paths = (args.length > 0 ? given : trackedFiles()).filter(isChecked);
  const files = paths.flatMap((path): FileLines[] => {
    try {
      return [{ path, lines: countLines(readFileSync(path, "utf8")) }];
    } catch {
      return []; // deleted or renamed away
    }
  });
  const over = overLimit(files);
  if (over.length === 0) {
    console.log(`check:lines: ${files.length} files, none over ${MAX_LINES} lines`);
    return 0;
  }
  console.error(
    `check:lines: ${over.length} file(s) over ${MAX_LINES} lines. Split them by topic:`,
  );
  for (const f of over) console.error(`  ${f.lines}  ${f.path}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
