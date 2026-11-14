import { describe, expect, it } from "vitest";
import { followScript, normaliseWord, scriptWordsOf, wordsMatch } from "./follow-script";

const script = scriptWordsOf(
  "Hello everyone and welcome back to the channel. Today we are talking about slow cooking. " +
    "First, chop the onions finely. Then add the garlic and stir. Finally, season with salt and pepper.",
).map(normaliseWord);
const heard = (s: string) => s.split(" ");

describe("followScript (spec 0021 AC-12)", () => {
  it("normalises punctuation and case", () => {
    expect(normaliseWord("Don't,")).toBe("dont");
    expect(scriptWordsOf("  a  b\nc ")).toEqual(["a", "b", "c"]);
  });

  it("matches words that are one letter apart only from five letters", () => {
    expect(wordsMatch("onions", "onion")).toBe(true);
    expect(wordsMatch("garlic", "garlik")).toBe(true);
    expect(wordsMatch("cat", "car")).toBe(false);
    expect(wordsMatch("", "")).toBe(false);
  });

  it("moves to the last matched word as the creator reads", () => {
    const a = followScript(script, heard("hello everyone and welcome"), -1);
    expect(a).toEqual({ matchIndex: 3, advanced: true });
    const b = followScript(
      script,
      heard("hello everyone and welcome back to the channel"),
      a.matchIndex,
    );
    expect(b.matchIndex).toBe(7);
  });

  it("ignores ad libs: words that match nothing change nothing", () => {
    const at = followScript(script, heard("hello everyone"), -1).matchIndex;
    expect(followScript(script, heard("you know like honestly"), at)).toEqual({
      matchIndex: at,
      advanced: false,
    });
  });

  it("jumps over a skipped line", () => {
    const at = followScript(script, heard("welcome back to the channel"), -1).matchIndex;
    const r = followScript(script, heard("first chop the onions finely"), at);
    expect(script[r.matchIndex]).toBe("finely");
  });

  it("never goes backwards when a line is repeated", () => {
    const at = followScript(script, heard("then add the garlic and stir"), -1).matchIndex;
    const again = followScript(script, heard("chop the onions finely"), at);
    expect(again).toEqual({ matchIndex: at, advanced: false });
  });

  it("does not let a short common word jump the prompter, but a longer single word counts", () => {
    expect(followScript(script, heard("the"), 5).advanced).toBe(false);
    expect(followScript(script, heard("talking"), 5).matchIndex).toBe(script.indexOf("talking"));
  });

  it("does not treat a revision of the same words as new speech", () => {
    const onions = scriptWordsOf("Chop the onions then fry the onions").map(normaliseWord);
    const first = followScript(onions, heard("chop the onions"), -1);
    expect(first).toEqual({ matchIndex: 2, advanced: true });
    // The interim result arrives again as its final revision: the position stays.
    const again = followScript(onions, heard("chop the onions"), first.matchIndex);
    expect(again).toMatchObject({ matchIndex: 2, advanced: false });
    // New words after the revision still move forward, onto the right "onions".
    expect(followScript(onions, heard("chop the onions then fry the onions"), 2).matchIndex).toBe(
      6,
    );
  });

  it("only looks a window ahead", () => {
    const long = [...Array(60).fill("filler"), "uniqueword", "another"];
    expect(followScript(long, heard("uniqueword another"), -1).advanced).toBe(false);
    expect(followScript(long, heard("uniqueword another"), 40).advanced).toBe(true);
  });

  it("is safe on empty input and at the end of the script", () => {
    expect(followScript([], heard("anything"), -1).advanced).toBe(false);
    expect(followScript(script, [], 2)).toEqual({ matchIndex: 2, advanced: false });
    const last = script.length - 1;
    expect(followScript(script, heard("salt and pepper"), last).advanced).toBe(false);
  });

  it("tolerates a transcriber spelling slip", () => {
    const r = followScript(script, heard("add the garlik and stir"), -1);
    expect(script[r.matchIndex]).toBe("stir");
  });
});

describe("followScript repeat flag", () => {
  const script = ["welcome", "to", "the", "show", "welcome", "back"];
  it("marks the same words again as a repeat", () => {
    expect(followScript(script, ["welcome"], 0)).toEqual({
      matchIndex: 0,
      advanced: false,
      repeat: true,
    });
  });
  it("does not mark unmatched speech as a repeat", () => {
    expect(followScript(script, ["banana"], 0).repeat).toBeUndefined();
  });
  it("does not call a new phrase a repeat because its last word matches the last match", () => {
    const long = [
      "welcome",
      ...Array<string>(39).fill("filler"),
      "fresh",
      "introduction",
      "welcome",
    ];
    const result = followScript(long, ["fresh", "introduction", "welcome"], 0);
    expect(result.repeat).toBeUndefined();
    expect(result.advanced).toBe(false);
    // recovery from the shown word (index 40) finds the phrase
    expect(followScript(long, ["fresh", "introduction", "welcome"], 39)).toMatchObject({
      matchIndex: 42,
      advanced: true,
    });
  });
});

describe("followScript overlapping tail", () => {
  const script = "welcome to the studio and welcome to the show".split(" ");
  it("lets the tail overlap the last match so a repeated phrase does not jump ahead", () => {
    const first = followScript(script, ["welcome"], -1);
    expect(first.matchIndex).toBe(0);
    const second = followScript(script, ["welcome", "to"], first.matchIndex);
    expect(second).toEqual({ matchIndex: 1, advanced: true });
  });
});
