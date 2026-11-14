import { describe, expect, it } from "vitest";
import {
  blockRect,
  pendingApplied,
  changeBody,
  cutName,
  NO_EDITS,
  normalizeEdits,
  nextCutIndex,
  numberCuts,
  pendingItems,
  pendingRanges,
  reasonLine,
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
  it("reason line is the label and the reason, null without one (spec 0012 AC-3)", () => {
    const n = numberCuts([
      {
        id: "a",
        startMs: 1000,
        endMs: 2000,
        kind: "ai",
        applied: true,
        reason: " You restarted. ",
      },
      { id: "b", startMs: 3000, endMs: 3400, kind: "pause", applied: true, reason: null },
      { id: "c", startMs: 4000, endMs: 4400, kind: "pause", applied: true },
    ]);
    expect(reasonLine(n[0])).toBe("Cut 1: You restarted.");
    expect(reasonLine(n[1])).toBeNull();
    expect(reasonLine(n[2])).toBeNull();
    expect(reasonLine(undefined)).toBeNull();
  });
  it("summary rounds half up", () => {
    expect(summaryLine([])).toBe("No pauses cut.");
    expect(summaryLine([{ ms: 400 }])).toBe("1 pause cut, 0.4 s saved.");
    expect(summaryLine([{ ms: 1450 }, { ms: 100 }])).toBe("2 pauses cut, 1.6 s saved.");
  });
  it("summary counts word cuts and pauses separately", () => {
    const w = (ms: number) => ({ ms, kind: "filler" });
    const p = (ms: number) => ({ ms, kind: "pause" });
    expect(summaryLine([w(1000), w(1000), w(1000), p(700), p(700)])).toBe(
      "3 word cuts and 2 pauses, 4.4 s saved.",
    );
    expect(summaryLine([w(500), p(400)])).toBe("1 word cut and 1 pause, 0.9 s saved.");
    expect(summaryLine([w(500), w(600)])).toBe("2 word cuts, 1.1 s saved.");
    expect(summaryLine([w(500)])).toBe("1 word cut, 0.5 s saved.");
    expect(summaryLine([p(400), p(1000)])).toBe("2 pauses cut, 1.4 s saved.");
  });
  it("summary matches the cut list after any keep or undo (C-36)", () => {
    const list = numberCuts([
      { id: "a", startMs: 1000, endMs: 1800, kind: "ai", applied: true },
      { id: "b", startMs: 2500, endMs: 3200, kind: "pause", applied: true },
      { id: "c", startMs: 4000, endMs: 4600, kind: "filler", applied: false },
    ]);
    const line = (edits: Parameters<typeof pendingApplied>[1]) => {
      const on = list.filter((c) => pendingApplied(c, edits));
      return {
        on: on.length,
        text: summaryLine(on.map((c) => ({ ms: c.endMs - c.startMs, kind: c.kind }))),
      };
    };
    expect(line(NO_EDITS)).toEqual({ on: 2, text: "1 word cut and 1 pause, 1.5 s saved." });
    const kept = toggleCut(NO_EDITS, list, null, "b");
    expect(line(kept)).toEqual({ on: 1, text: "1 word cut, 0.8 s saved." });
    const more = toggleCut(kept, list, null, "c");
    expect(line(more)).toEqual({ on: 2, text: "2 word cuts, 1.4 s saved." });
    const none = toggleCut(toggleCut(more, list, null, "a"), list, null, "c");
    expect(line(none)).toEqual({ on: 0, text: "No pauses cut." });
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
  it("arrow, Home and End move between cuts and stop at the ends (B2-T97)", () => {
    expect(nextCutIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextCutIndex("ArrowDown", 1, 3)).toBe(2);
    expect(nextCutIndex("ArrowRight", 2, 3)).toBe(2);
    expect(nextCutIndex("ArrowLeft", 2, 3)).toBe(1);
    expect(nextCutIndex("ArrowUp", 0, 3)).toBe(0);
    expect(nextCutIndex("Home", 2, 3)).toBe(0);
    expect(nextCutIndex("End", 0, 3)).toBe(2);
    expect(nextCutIndex("Tab", 0, 3)).toBeNull();
    expect(nextCutIndex("Enter", 0, 3)).toBeNull();
    expect(nextCutIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
