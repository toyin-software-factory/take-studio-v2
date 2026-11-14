import { describe, expect, it } from "vitest";
import {
  TELEPROMPTER,
  advance,
  clampSize,
  clampWpm,
  commandForKey,
  countWords,
  lineAt,
  positionAt,
  progress,
  splitLines,
  stepSize,
  stepWpm,
} from "./teleprompter";

const none = { ctrl: false, alt: false, meta: false };

describe("advance and positionAt", () => {
  it("is words passed at the speed", () => {
    expect(positionAt(60_000, 140, 1000)).toBe(140);
    expect(positionAt(30_000, 120, 1000)).toBe(60);
  });
  it("clamps at the end and never goes backwards", () => {
    expect(positionAt(10 * 60_000, 140, 100)).toBe(100);
    expect(advance(50, -500, 140, 100)).toBe(50);
    expect(advance(50, 0, 140, 100)).toBe(50);
  });
  it("a speed change only affects what comes after it", () => {
    const first = advance(0, 30_000, 100, 1000);
    const second = advance(first, 30_000, 200, 1000);
    expect(first).toBe(50);
    expect(second).toBe(150);
    // Changing speed at the same moment never moves the position.
    expect(advance(first, 0, 260, 1000)).toBe(first);
  });
  it("an empty script stays at 0", () => {
    expect(positionAt(60_000, 140, 0)).toBe(0);
    expect(progress(0, 0)).toBe(0);
  });
});

describe("speed and size", () => {
  it("keeps the speed in 60 to 260 in steps of 10", () => {
    expect(clampWpm(5)).toBe(60);
    expect(clampWpm(999)).toBe(260);
    expect(clampWpm(143)).toBe(140);
    expect(clampWpm(NaN)).toBe(TELEPROMPTER.wpmDefault);
    expect(stepWpm(260, 1)).toBe(260);
    expect(stepWpm(60, -1)).toBe(60);
    expect(stepWpm(140, 1)).toBe(150);
  });
  it("has five sizes from 28 to 64", () => {
    expect(TELEPROMPTER.sizes).toHaveLength(5);
    expect(stepSize(44, 1)).toBe(54);
    expect(stepSize(64, 1)).toBe(64);
    expect(stepSize(28, -1)).toBe(28);
    expect(clampSize(50)).toBe(54);
    expect(clampSize(NaN)).toBe(44);
  });
});

describe("lines", () => {
  it("splits at line breaks, drops blanks and counts words", () => {
    const lines = splitLines("Hello there\n\nthird line here\r\nlast");
    expect(lines.map((l) => l.text)).toEqual(["Hello there", "third line here", "last"]);
    expect(lines.map((l) => l.startWord)).toEqual([0, 2, 5]);
    expect(countWords("Hello there\n\nthird line here\nlast")).toBe(6);
  });
  it("cuts a long line into pieces", () => {
    const lines = splitLines("a b c d e f g", 3);
    expect(lines.map((l) => l.words)).toEqual([3, 3, 1]);
  });
  it("finds the line holding a position", () => {
    const lines = splitLines("one two\nthree four five\nsix");
    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 1.9)).toBe(0);
    expect(lineAt(lines, 2)).toBe(1);
    expect(lineAt(lines, 99)).toBe(2);
    expect(lineAt([], 3)).toBe(0);
  });
});

describe("commandForKey", () => {
  it("maps the shortcuts", () => {
    expect(commandForKey("p", { tagName: "DIV" }, none)).toBe("toggle");
    expect(commandForKey("ArrowUp", null, none)).toBe("faster");
    expect(commandForKey("ArrowDown", null, none)).toBe("slower");
    expect(commandForKey("+", null, none)).toBe("larger");
    expect(commandForKey("-", null, none)).toBe("smaller");
    expect(commandForKey("x", null, none)).toBeNull();
  });
  it("never fires in a text field or with a modifier", () => {
    expect(commandForKey("p", { tagName: "TEXTAREA" }, none)).toBeNull();
    expect(commandForKey("p", { tagName: "input" }, none)).toBeNull();
    expect(commandForKey("p", { tagName: "DIV", isContentEditable: true }, none)).toBeNull();
    expect(commandForKey("p", null, { ...none, ctrl: true })).toBeNull();
    expect(commandForKey("-", null, { ...none, meta: true })).toBeNull();
  });
});
