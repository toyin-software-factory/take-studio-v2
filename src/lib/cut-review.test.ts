import { describe, expect, it } from "vitest";
import {
  blockRect,
  changeBody,
  cutName,
  NO_EDITS,
  normalizeEdits,
  numberCuts,
  pendingItems,
  pendingRanges,
  setBackgroundEdit,
  summaryLine,
  timelineWidth,
  toggleCut,
} from "./cut-review";

const cuts = [
  { id: "b", startMs: 5000, endMs: 5400, kind: "filler", applied: false },
  { id: "a", startMs: 1000, endMs: 2400, kind: "pause", applied: true },
  { id: "c", startMs: 8000, endMs: 8500, kind: "pause", applied: true },
];

describe("cut review model", () => {
  it("numbers in time order with labels and names", () => {
    const n = numberCuts(cuts);
    expect(n.map((c) => c.label)).toEqual(["Pause 1", "Cut 2", "Pause 3"]);
    expect(cutName(n[0]!, true)).toBe("Pause 1, 1.4 seconds, cut. Press to keep it.");
    expect(cutName(n[1]!, false)).toBe("Cut 2, 0.4 seconds, kept. Press to cut it.");
  });
  it("summary rounds half up", () => {
    expect(summaryLine([])).toBe("No pauses cut.");
    expect(summaryLine([{ ms: 400 }])).toBe("1 pause cut, 0.4 s saved.");
    expect(summaryLine([{ ms: 1450 }, { ms: 100 }])).toBe("2 pauses cut, 1.6 s saved.");
  });
  it("toggling twice returns to no edits", () => {
    const once = toggleCut(NO_EDITS, cuts, null, "a");
    expect(once.cuts).toEqual({ a: false });
    expect(toggleCut(once, cuts, null, "a")).toEqual(NO_EDITS);
  });
  it("rebase drops edits that now match", () => {
    const edits = { cuts: { a: false, b: true }, background: "x" };
    const moved = cuts.map((c) => (c.id === "a" ? { ...c, applied: false } : c));
    expect(normalizeEdits(edits, moved, "x")).toEqual({ cuts: { b: true }, background: undefined });
  });
  it("picking the current background removes the change; deleted stays", () => {
    expect(setBackgroundEdit(NO_EDITS, cuts, "x", "x").background).toBeUndefined();
    expect(setBackgroundEdit(NO_EDITS, cuts, "x", null).background).toBeNull();
  });
  it("lists items in order, cuts first", () => {
    const edits = { cuts: { b: true, a: false }, background: null };
    expect(
      pendingItems(cuts, edits, (id) => (id ? "Warm studio" : "Original")).map((i) => i.text),
    ).toEqual(["Keep pause 1", "Cut cut 2", "Background: Original"]);
  });
  it("pending ranges and body", () => {
    const edits = { cuts: { b: true, a: false }, background: undefined };
    expect(pendingRanges(cuts, edits)).toEqual([
      { startMs: 5000, endMs: 5400 },
      { startMs: 8000, endMs: 8500 },
    ]);
    expect(changeBody("r", edits)).toEqual({
      baseRenderId: "r",
      cuts: [
        { id: "b", applied: true },
        { id: "a", applied: false },
      ],
    });
  });
  it("width rule and block geometry", () => {
    expect(timelineWidth(300, 10_000)).toBe(300);
    expect(timelineWidth(300, 100_000)).toBe(800);
    const r = blockRect({ startMs: 0, endMs: 10 }, 10_000, 800);
    expect(r.width).toBe(12);
    expect(r.hitWidth).toBe(24);
    expect(r.left).toBe(0);
  });
});
