import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Source = { readonly file: string; readonly text: string };

// A take's status changes only through `transitionTake` (src/db/AGENTS.md). Only these files may
// write the status column of the take table themselves, each with its reason:
const TAKE_STATUS_HOMES = [
  // `transitionTake` itself: the one compare and swap every other path calls.
  "src/db/data/takes.ts",
  // `expireTake` writes `expired` after it holds the take row lock and has queued the file deletes,
  // in the same transaction (the transition table has no single from status for it).
  "src/db/data/deletion.ts",
];

const UPDATE_TAKE_SET = /\.\s*update\(\s*take\s*\)\s*\.\s*set\(/g;

/** The index after the string or template literal that starts at `i` (`${...}` is skipped whole). */
function skipQuoted(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== quote) {
    if (text[j] === "\\") j += 1;
    else if (quote === "`" && text[j] === "$" && text[j + 1] === "{")
      j = skipBalanced(text, j + 1) - 1;
    j += 1;
  }
  return j + 1;
}

/** The index after the bracket group that opens at `i`, whatever strings or nesting is inside. */
function skipBalanced(text: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j]!;
    if (c === '"' || c === "'" || c === "`") {
      j = skipQuoted(text, j);
      continue;
    }
    if ("({[".includes(c)) depth += 1;
    if (")}]".includes(c)) depth -= 1;
    j += 1;
    if (depth === 0) return j;
  }
  return j;
}

/** The top level parts of an object literal body, split on commas outside any nesting or string. */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let j = 0;
  while (j < body.length) {
    const c = body[j]!;
    if (c === '"' || c === "'" || c === "`") j = skipQuoted(body, j);
    else if ("({[".includes(c)) j = skipBalanced(body, j);
    else {
      if (c === ",") {
        parts.push(body.slice(start, j));
        start = j + 1;
      }
      j += 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** True when the `.set(` argument after `open` writes `status` or cannot be read as an object literal. */
function setsStatus(text: string, open: number): boolean {
  const arg = text.slice(open, skipBalanced(text, open - 1) - 1).trim();
  if (!arg.startsWith("{") || skipBalanced(arg, 0) !== arg.length) return true;
  return topLevelParts(arg.slice(1, -1)).some((part) => {
    const p = part.trim();
    return p.startsWith("...") || /^(status|["']status["'])\s*(:|$)/.test(p);
  });
}

/** Files (other than `allowed`) with an `update(take).set(...)` that writes `status`, or whose
 * `.set(...)` argument is not an object literal (so it cannot be read). */
export function statusWritesOutside(sources: readonly Source[], allowed: readonly string[]) {
  return sources
    .filter((s) => !allowed.includes(s.file))
    .filter((s) =>
      [...s.text.matchAll(UPDATE_TAKE_SET)].some((m) => setsStatus(s.text, m.index + m[0].length)),
    )
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

describe("scan: a take's status changes only through transitionTake", () => {
  const bad = (set: string) => [
    { file: "src/server/x.ts", text: `await tx\n  .update(take)\n  .set(${set})\n  .where(a);` },
  ];
  it("fires on a direct status write outside the allow list", () => {
    expect(statusWritesOutside(bad('{ status: "ready" }'), TAKE_STATUS_HOMES)).toEqual([
      "src/server/x.ts",
    ]);
    expect(statusWritesOutside(bad('{ title, "status": "ready" }'), TAKE_STATUS_HOMES)).toEqual([
      "src/server/x.ts",
    ]);
    expect(statusWritesOutside(bad("{ ...changes, status: to }"), TAKE_STATUS_HOMES)).toEqual([
      "src/server/x.ts",
    ]);
    expect(statusWritesOutside(bad("changes"), TAKE_STATUS_HOMES)).toEqual(["src/server/x.ts"]);
    // A `}` inside an earlier value (a template interpolation) does not hide the status key.
    expect(
      statusWritesOutside(bad('{ title: sql`${take.title}`, status: "ready" }'), TAKE_STATUS_HOMES),
    ).toEqual(["src/server/x.ts"]);
  });
  it("allows other columns, other tables, and the allow listed files", () => {
    expect(statusWritesOutside(bad("{ title }"), TAKE_STATUS_HOMES)).toEqual([]);
    // The word "status:" inside a value, or a nested object's key, is not a status key.
    expect(statusWritesOutside(bad('{ title: "new status: ready" }'), TAKE_STATUS_HOMES)).toEqual(
      [],
    );
    expect(
      statusWritesOutside(bad("{ title: sql`${x}`, note: { status: 1 } }"), TAKE_STATUS_HOMES),
    ).toEqual([]);
    expect(
      statusWritesOutside(
        [{ file: "src/db/data/x.ts", text: 'tx.update(render).set({ status: "failed" })' }],
        TAKE_STATUS_HOMES,
      ),
    ).toEqual([]);
    const home = [{ file: TAKE_STATUS_HOMES[0]!, text: bad('{ status: "ready" }')[0]!.text }];
    expect(statusWritesOutside(home, TAKE_STATUS_HOMES)).toEqual([]);
  });
  it("finds no other status write in src today", () => {
    expect(statusWritesOutside(sourcesUnder("src"), TAKE_STATUS_HOMES)).toEqual([]);
  });
});
