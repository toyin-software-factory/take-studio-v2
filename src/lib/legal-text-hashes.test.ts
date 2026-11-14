import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSION } from "./legal-facts";
import { LEGAL_TEXT_HASHES, type RecordedHash } from "./legal-text-hashes";

/** What the next line records as `after`: a digest of this line and of the one it follows. */
export function lineDigest(entry: RecordedHash): string {
  return createHash("sha256")
    .update(`${entry.date}|${entry.hash}|${entry.after ?? ""}`)
    .digest("hex");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything wrong with one page's history, as plain sentences (empty when it is sound). */
export function historyProblems(lines: readonly RecordedHash[], today: string): string[] {
  const problems: string[] = [];
  if (lines.length === 0) problems.push("the history is empty");
  lines.forEach((line, i) => {
    if (!ISO_DATE.test(line.date)) problems.push(`line ${i + 1} has no ISO date`);
    if (line.date > today) problems.push(`line ${i + 1} is dated after today`);
    const before = lines[i - 1];
    if (!before) {
      if (line.after !== undefined) problems.push("line 1 must not carry `after`");
      return;
    }
    if (line.date < before.date) problems.push(`line ${i + 1} is dated before line ${i}`);
    if (line.hash === before.hash) problems.push(`line ${i + 1} repeats the hash before it`);
    if (line.after !== lineDigest(before)) {
      problems.push(`line ${i} was changed or removed (line ${i + 1} does not follow it)`);
    }
  });
  return problems;
}

const today = new Date().toISOString().slice(0, 10);
const link = (before: RecordedHash, next: Omit<RecordedHash, "after">): RecordedHash => ({
  ...next,
  after: lineDigest(before),
});

describe("the recorded text hash history (AC-7, AC-9)", () => {
  for (const page of ["privacy", "terms"] as const) {
    it(`${page}: the history is sound, and LEGAL_VERSION is not after today`, () => {
      expect(historyProblems(LEGAL_TEXT_HASHES[page], today)).toEqual([]);
      expect(LEGAL_VERSION[page] <= today).toBe(true);
    });
  }
});

describe("historyProblems", () => {
  const first: RecordedHash = { date: "2026-11-14", hash: "aaa" };
  const second = link(first, { date: "2026-11-14", hash: "bbb" });
  const third = link(second, { date: "2026-11-15", hash: "ccc" });

  it("accepts a second change on the same date, appended with its link", () => {
    expect(historyProblems([first, second, third], "2026-11-15")).toEqual([]);
  });

  it("fails when an older line is edited", () => {
    const edited = { ...first, hash: "zzz" };
    expect(historyProblems([edited, second, third], "2026-11-15")).not.toEqual([]);
  });

  it("fails when an older line is removed", () => {
    expect(historyProblems([first, third], "2026-11-15")).not.toEqual([]);
  });

  it("fails when a new line has no link, or goes back in time", () => {
    expect(historyProblems([first, { date: "2026-11-14", hash: "bbb" }], "2026-11-15")).not.toEqual(
      [],
    );
    const back = link(second, { date: "2026-11-13", hash: "ccc" });
    expect(historyProblems([first, second, back], "2026-11-15")).not.toEqual([]);
  });

  it("fails when a line is dated after today", () => {
    expect(historyProblems([first, second, third], "2026-11-14")).not.toEqual([]);
  });
});
