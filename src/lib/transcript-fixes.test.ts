import { describe, expect, it } from "vitest";
import { transcriptViewSchema } from "./take-api";
import { fixLine, visibleEdits, withEditUndone } from "./transcript-fixes";

const view = transcriptViewSchema.parse({
  state: "ready",
  canMake: false,
  version: "1.a",
  paragraphs: [
    {
      startMs: 0,
      words: [
        { index: 0, w: "Hello", startMs: 0, endMs: 200, filler: false },
        { index: 1, w: "Kubernetes", startMs: 200, endMs: 600, filler: false },
      ],
    },
  ],
  edits: [
    { index: 1, old: "Cuber nettys", new: "Kubernetes", reason: "A name", undone: false },
    { index: 9, old: "x", new: "y", reason: "", undone: false },
  ],
});

describe("transcript fixes", () => {
  it("words a fix with and without a reason", () => {
    expect(fixLine(view.edits[0]!)).toBe("“Cuber nettys” → “Kubernetes”: A name");
    expect(fixLine(view.edits[1]!)).toBe("“x” → “y”");
  });

  it("lists only fixes whose word is in the trimmed video", () => {
    expect(visibleEdits(view).map((e) => e.index)).toEqual([1]);
  });

  it("swaps the word and the version on undo, and back on redo", () => {
    const undone = withEditUndone(view, 1, true, "2.a");
    expect(undone.paragraphs?.[0]?.words[1]?.w).toBe("Cuber nettys");
    expect(undone.edits[0]?.undone).toBe(true);
    expect(undone.version).toBe("2.a");
    const redone = withEditUndone(undone, 1, false, "3.a");
    expect(redone.paragraphs?.[0]?.words[1]?.w).toBe("Kubernetes");
    expect(redone.version).toBe("3.a");
  });

  it("ignores an index with no fix", () => {
    expect(withEditUndone(view, 5, true, "x")).toBe(view);
  });

  it("reads a view with no edits as an empty list", () => {
    expect(transcriptViewSchema.parse({ state: "none", canMake: true }).edits).toEqual([]);
  });
});
