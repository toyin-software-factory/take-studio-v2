import { describe, expect, it } from "vitest";
import {
  buildCues,
  toPlainText,
  toSrt,
  toTrimmedTranscript,
  type TrimmedParagraph,
} from "./transcript-timeline";
import { alignToFrames, keepRanges } from "./trim";
import { trimmedWord, word } from "./transcript-timeline-test-helpers";

describe("toPlainText", () => {
  it("separates paragraphs with a blank line and leaves out fillers and timestamps", () => {
    const paragraphs: TrimmedParagraph[] = [
      {
        startMs: 0,
        words: [
          trimmedWord("Um,", 0, 200, true),
          trimmedWord("Hello", 200, 500),
          trimmedWord("there.", 500, 900),
        ],
      },
      { startMs: 2000, words: [trimmedWord("uh", 2000, 2200, true)] },
      { startMs: 4000, words: [trimmedWord("Bye.", 4000, 4400)] },
    ];
    expect(toPlainText(paragraphs)).toBe("Hello there.\n\nBye.\n");
  });

  it("is empty when there is nothing to write", () => {
    expect(toPlainText([])).toBe("");
  });
});
describe("the SRT of a trimmed take lines up with the trimmed video", () => {
  it("lands each cue within one frame of the word on the trimmed timeline", () => {
    // 10 s clip at 25 fps, a pause from 3 s to 5.5 s removed (what `trim` would cut).
    const fps = 25;
    const removed = [{ startMs: 3000, endMs: 5500 }];
    const stored = [
      word("Before", 500, 1000, { para: true }),
      word("the", 1000, 1200),
      word("pause.", 1200, 2800),
      word("After", 5600, 6100, { para: true }),
      word("it.", 6100, 6600),
    ];
    const keep = alignToFrames(keepRanges(removed, 10_000), fps);
    const trimmed = toTrimmedTranscript(stored, {
      durationMs: 10_000,
      sourceFps: fps,
      removedRanges: removed,
    });
    const cues = buildCues(trimmed);
    expect(cues.map((c) => c.text)).toEqual(["Before the pause.", "After it."]);
    const frameMs = 1000 / fps;
    // "After" starts at 5600 on the original; the keep ranges drop 2.5 s, so 3100 on the trimmed.
    const removedBefore = (keep[1]?.startMs ?? 0) - (keep[0]?.endMs ?? 0);
    expect(Math.abs((cues[1]?.startMs ?? 0) - (5600 - removedBefore))).toBeLessThanOrEqual(frameMs);
    expect(Math.abs((cues[0]?.startMs ?? 0) - 500)).toBeLessThanOrEqual(frameMs);
    expect(toSrt(cues).startsWith("1\n00:00:00,500 --> ")).toBe(true);
  });
});
