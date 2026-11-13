import { describe, expect, it } from "vitest";
import { FILLER_WORDS, editedWords, isFillerWord } from "./transcript-rules";

describe("filler words (spec 0007)", () => {
  it("holds exactly the spec's list", () => {
    expect(FILLER_WORDS).toEqual(["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm"]);
  });

  it.each(["um", "Um,", "UH.", "Hmm...", "umm", "Erm?", "ah!", "mm"])("%s is a filler", (word) => {
    expect(isFillerWord(word)).toBe(true);
  });

  it.each(["umbrella", "uh-huh yes", "hum", "", "...", "hello", "mmm", "a"])(
    "%s is not a filler",
    (word) => {
      expect(isFillerWord(word)).toBe(false);
    },
  );
});

describe("editedWords (spec 0012)", () => {
  const words = ["Hi", "Jon", "here."].map((w, i) => ({
    w,
    startMs: i * 100,
    endMs: i * 100 + 90,
    conf: 1,
    filler: false,
    para: i === 0,
  }));
  const fix = { index: 1, old: "Jon", new: "John", reason: "r", undone: false };

  it("replaces only the text of a live fix and keeps count, order and times", () => {
    const out = editedWords(words, [fix]);
    expect(out.map((x) => x.w)).toEqual(["Hi", "John", "here."]);
    expect(out.map((x) => [x.startMs, x.endMs])).toEqual(words.map((x) => [x.startMs, x.endMs]));
  });

  it("ignores an undone fix and a stale one whose old text no longer matches", () => {
    expect(editedWords(words, [{ ...fix, undone: true }])).toEqual(words);
    expect(editedWords(words, [{ ...fix, old: "Joan" }]).map((x) => x.w)).toEqual([
      "Hi",
      "Jon",
      "here.",
    ]);
    expect(editedWords(words, [{ ...fix, index: 9 }]).map((x) => x.w)).toEqual([
      "Hi",
      "Jon",
      "here.",
    ]);
  });

  it("does not change its input", () => {
    editedWords(words, [fix]);
    expect(words[1]?.w).toBe("Jon");
  });
});
