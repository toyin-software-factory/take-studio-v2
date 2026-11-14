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

/**
 * Lines already recorded when this was written: a history must still hold this many lines and
 * the last of them must be unchanged, so deleting a recorded suffix (and putting the copy back)
 * fails. Raise a floor when you append (count and the digest the test prints); never lower one.
 */
export const FLOOR: Readonly<Record<"privacy" | "terms", { count: number; digest: string }>> = {
  privacy: { count: 5, digest: "41233760000262cfc4d03814f33c0889377991dee307ffffdec733de54cbc79d" },
  terms: { count: 4, digest: "b10f9cb91c20f0899ce3bcb823130917477fb7c0d9f39219bb1b543bdeb19160" },
};

export function floorProblems(
  lines: readonly RecordedHash[],
  floor: { count: number; digest: string },
): string[] {
  const kept = lines[floor.count - 1];
  if (!kept) return [`the history lost lines: it must keep at least ${floor.count}`];
  return lineDigest(kept) === floor.digest ? [] : [`line ${floor.count} was changed`];
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
    it(`${page}: no recorded line was deleted or changed`, () => {
      expect(floorProblems(LEGAL_TEXT_HASHES[page], FLOOR[page])).toEqual([]);
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

  it("fails when a recorded suffix is deleted, or the last recorded line is changed", () => {
    const floor = { count: 3, digest: lineDigest(third) };
    expect(floorProblems([first, second, third], floor)).toEqual([]);
    expect(
      floorProblems([first, second, third, link(third, { date: "2026-11-15", hash: "d" })], floor),
    ).toEqual([]);
    expect(floorProblems([first], floor)).not.toEqual([]);
    expect(floorProblems([first, second, { ...third, hash: "zzz" }], floor)).not.toEqual([]);
  });

  it("fails when a line is dated after today", () => {
    expect(historyProblems([first, second, third], "2026-11-14")).not.toEqual([]);
  });
});
