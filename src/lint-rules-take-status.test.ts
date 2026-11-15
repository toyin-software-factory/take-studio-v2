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

const UPDATE_TAKE_SET = /\.\s*update\(\s*take\s*\)\s*\.\s*set\(\s*(\{[^}]*\}|[^{)][^)]*)\)/g;
const STATUS_KEY = /(^|[{,\s])status\s*[:,}]|["']status["']\s*:|\.\.\./;

/** Files (other than `allowed`) with an `update(take).set(...)` that writes `status`, or whose
 * `.set(...)` argument is not an object literal (so it cannot be read). */
export function statusWritesOutside(sources: readonly Source[], allowed: readonly string[]) {
  return sources
    .filter((s) => !allowed.includes(s.file))
    .filter((s) =>
      [...s.text.matchAll(UPDATE_TAKE_SET)].some(
        (m) => STATUS_KEY.test(m[1] ?? "") || !m[1]?.startsWith("{"),
      ),
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
  });
  it("allows other columns, other tables, and the allow listed files", () => {
    expect(statusWritesOutside(bad("{ title }"), TAKE_STATUS_HOMES)).toEqual([]);
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
