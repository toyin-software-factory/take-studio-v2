import { describe, expect, it } from "vitest";
import { type AiEditAnswer, AI_EDIT, validateAiEdit } from "./ai-edit";
import { data, empty, w } from "./ai-edit-test-helpers";

describe("validateAiEdit", () => {
  it("cuts every candidate it does not keep, with the rules reason, proposed by ai", () => {
    const d = data({});
    expect(d.cuts).toEqual([
      expect.objectContaining({ startMs: 2100, endMs: 3900, kind: "pause", applied: true }),
      expect.objectContaining({ startMs: 5100, endMs: 9900, reason: "Pause of 4.8 s" }),
    ]);
    expect(d.cuts.every((c) => c.proposedBy === "ai")).toBe(true);
  });

  it("stores a kept pause unapplied with the AI reason", () => {
    const d = data({ keepPauses: [{ candidate: 0, reason: "Dramatic beat" }] });
    expect(d.cuts[0]).toMatchObject({ applied: false, reason: "Dramatic beat", kind: "pause" });
    expect(d.cuts).toHaveLength(2);
  });

  it("gives a kept pause with no reason the default, and drops a bad or repeated one", () => {
    const d = data({
      keepPauses: [
        { candidate: 0, reason: "  " },
        { candidate: 0, reason: "again" },
        { candidate: 9, reason: "nope" },
      ],
      fixes: [{ index: 5, old: "Jon", new: "John", reason: "name" }],
    });
    expect(d.cuts[0]?.reason).toBe(AI_EDIT.keptPauseReason);
    expect(d.dropped).toBe(2);
  });

  it("keeps the unsmoothed word cut when smoothing would pass the share limit (spec 0020)", () => {
    const words = [
      { w: "a", startMs: 0, endMs: 100, filler: false },
      { w: "uh", startMs: 200, endMs: 300, filler: true },
      { w: "b", startMs: 800, endMs: 900, filler: false },
    ];
    const answer: AiEditAnswer = {
      keepPauses: [],
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "filler", reason: "filler" }],
      fixes: [],
      background: null,
    } as unknown as AiEditAnswer;
    const r = validateAiEdit(answer, words, [], 1_000);
    if (!r.ok) throw new Error("expected valid");
    // 200 to 800 is 60%; smoothing would take the start to 150 and pass the limit.
    expect(r.data.cuts[0]).toMatchObject({ startMs: 200, endMs: 800 });
  });

  it("keeps the unsmoothed word cut when smoothing would pass the per cut limit (spec 0020)", () => {
    const words = [
      { w: "a", startMs: 0, endMs: 800, filler: false },
      { w: "x", startMs: 1_000, endMs: 20_900, filler: true },
      { w: "b", startMs: 21_000, endMs: 22_000, filler: false },
    ];
    const answer = {
      keepPauses: [],
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "filler", reason: "filler" }],
      fixes: [],
      background: null,
    } as unknown as AiEditAnswer;
    const r = validateAiEdit(answer, words, [], 60_000);
    if (!r.ok) throw new Error("expected valid");
    expect(r.data.cuts[0]).toMatchObject({ startMs: 1_000, endMs: 21_000 });
  });

  it("places a word cut from the first word's start to the next word's start", () => {
    const d = data({
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "filler", reason: "Filler word" }],
    });
    expect(d.cuts).toContainEqual(
      expect.objectContaining({ startMs: 450, endMs: 800, kind: "filler", applied: true }),
    );
  });

  it("ends the last word cut at the take's end", () => {
    const words = [w("a", 0, 100), w("b", 9000, 9500)];
    const r = validateAiEdit(
      { ...empty, wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "end" }] },
      words,
      [],
      10_000,
    );
    expect(r.ok && r.data.cuts).toEqual([
      expect.objectContaining({ startMs: 8920, endMs: 10_000, kind: "false_start" }),
    ]);
  });

  it("ends a word cut at a kept pause that starts inside it", () => {
    const d = data({
      keepPauses: [{ candidate: 0, reason: "Beat" }],
      wordCuts: [{ fromWord: 5, toWord: 5, kind: "false_start", reason: "Restart" }],
    });
    const wc = d.cuts.find((c) => c.kind === "false_start");
    // The start moves 50 ms into the gap after "is" (spec 0020); the end meets a kept pause.
    expect(wc).toMatchObject({ startMs: 1650, endMs: 2100 });
    expect(d.cuts.find((c) => c.applied === false)).toMatchObject({ startMs: 2100 });
  });

  it("merges a word cut with the cut pause it overlaps, keeping the word cut's kind and reason", () => {
    const d = data({
      wordCuts: [{ fromWord: 5, toWord: 5, kind: "false_start", reason: "Restart" }],
    });
    expect(d.cuts[0]).toMatchObject({
      startMs: 1650,
      endMs: 4000,
      kind: "false_start",
      reason: "Restart",
    });
    expect(d.cuts).toHaveLength(2);
  });

  it("never merges an unapplied kept pause", () => {
    const d = data({
      keepPauses: [{ candidate: 0, reason: "Beat" }],
      wordCuts: [{ fromWord: 6, toWord: 6, kind: "false_start", reason: "Restart" }],
    });
    expect(d.cuts.filter((c) => c.applied === false)).toHaveLength(1);
    expect(d.cuts.find((c) => c.kind === "false_start")).toMatchObject({ startMs: 4000 });
  });

  it("drops word cuts that are out of range, reversed, over 20 s, or empty of reason", () => {
    const d = data({
      keepPauses: [{ candidate: 0, reason: "k" }],
      wordCuts: [
        { fromWord: 3, toWord: 2, kind: "false_start", reason: "reversed" },
        { fromWord: 0, toWord: 99, kind: "false_start", reason: "range" },
        { fromWord: -1, toWord: 0, kind: "false_start", reason: "neg" },
        { fromWord: 2, toWord: 2, kind: "false_start", reason: " " },
        { fromWord: 2, toWord: 3, kind: "false_start", reason: "ok" },
      ],
      fixes: [
        { index: 0, old: "Hello", new: "Hallo", reason: "a" },
        { index: 3, old: "name", new: "Name", reason: "b" },
        { index: 4, old: "is", new: "Is", reason: "c" },
        { index: 5, old: "Jon", new: "John", reason: "d" },
      ],
    });
    expect(d.dropped).toBe(4);
  });

  it("keeps a filler cut over plain words, still drops a fix on a filler word", () => {
    const words = [w("Um,", 0, 100, false), w("so", 200, 300), w("fine", 400, 500)];
    const ok = validateAiEdit(
      {
        ...empty,
        wordCuts: [
          { fromWord: 0, toWord: 0, kind: "filler", reason: "um" },
          { fromWord: 1, toWord: 1, kind: "filler", reason: "Says nothing" },
        ],
        fixes: [{ index: 2, old: "fine", new: "Fine.", reason: "caps" }],
      },
      words,
      [],
      1000,
    );
    expect(ok.ok && ok.data.cuts).toHaveLength(2);
    expect(ok.ok && ok.data.dropped).toBe(0);
    const bad = validateAiEdit(
      {
        ...empty,
        keepPauses: [],
        wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "ok" }],
        fixes: [{ index: 0, old: "Um,", new: "Um.", reason: "ok" }],
      },
      words,
      [],
      10_000,
    );
    // the fix on a filler is dropped; 1 of 2 items dropped is not over half: answer kept
    expect(bad.ok && bad.data.dropped).toBe(1);
  });

  it("Meaning cuts: nonsense speech and an earlier attempt are cut with their reasons", () => {
    const words = [
      w("blah", 0, 200),
      w("blah", 250, 450),
      w("blah", 500, 700),
      w("Welcome", 1000, 1300),
      w("to", 1350, 1450),
      w("Welcome", 2000, 2300),
      w("to", 2350, 2450),
      w("my", 2500, 2600),
      w("channel", 2650, 3000),
    ];
    const r = validateAiEdit(
      {
        ...empty,
        wordCuts: [
          { fromWord: 0, toWord: 2, kind: "filler", reason: "Placeholder speech" },
          { fromWord: 3, toWord: 4, kind: "false_start", reason: "Said again below" },
        ],
      },
      words,
      [],
      10_000,
    );
    expect(r.ok && r.data.dropped).toBe(0);
    expect(r.ok && r.data.cuts.map((c) => [c.kind, c.reason])).toEqual([
      ["filler", "Placeholder speech"],
      ["false_start", "Said again below"],
    ]);
  });
});
