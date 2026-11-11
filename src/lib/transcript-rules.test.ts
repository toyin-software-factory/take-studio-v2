import { describe, expect, it } from "vitest";
import { FILLER_WORDS, isFillerWord } from "./transcript-rules";

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
