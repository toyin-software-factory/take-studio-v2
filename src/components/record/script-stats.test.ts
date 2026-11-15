import { describe, expect, it } from "vitest";
import { charCount, clock, countWords, readingTime } from "./script-stats";

describe("script stats", () => {
  it("counts words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n ")).toBe(0);
    expect(countWords("one  two\nthree")).toBe(3);
  });
  it("formats a clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(61.4)).toBe("1:01");
    expect(clock(-5)).toBe("0:00");
  });
  it("says how long a script takes", () => {
    expect(readingTime(0, 140)).toBe("No script: just talk");
    expect(readingTime(140, 140)).toBe("about 1:00 at 140 wpm");
    expect(readingTime(70, 140)).toBe("about 0:30 at 140 wpm");
  });
  it("formats the counter", () => {
    expect(charCount(1234, 20000)).toBe("1,234 / 20,000");
  });
});
