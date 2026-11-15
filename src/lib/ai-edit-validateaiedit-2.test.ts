import { describe, expect, it } from "vitest";
import { wordCutMaxShareFor, AI_EDIT, validateAiEdit } from "./ai-edit";
import { data, empty, run, w } from "./ai-edit-test-helpers";

describe("validateAiEdit", () => {
  it("applies the 20 s limit again after merging: the pause stays alone", () => {
    const long = validateAiEdit(
      {
        ...empty,
        wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "r" }],
        fixes: [{ index: 0, old: "a", new: "A", reason: "r" }],
        background: null,
      },
      [w("a", 0, 100), w("b", 1000, 1100), w("c", 1900, 2000)],
      [{ startMs: 1500, endMs: 30_000, reason: "Long" }],
      60_000,
    );
    expect(long.ok && long.data.cuts).toEqual([
      expect.objectContaining({ kind: "pause", startMs: 1500, endMs: 30_000 }),
    ]);
    expect(long.ok && long.data.dropped).toBe(1);
  });

  it("never returns overlapping cuts after a word cut expands into a pause", () => {
    const r = validateAiEdit(
      {
        ...empty,
        wordCuts: [
          { fromWord: 0, toWord: 0, kind: "false_start", reason: "r1" },
          { fromWord: 1, toWord: 1, kind: "false_start", reason: "r2" },
          { fromWord: 2, toWord: 2, kind: "false_start", reason: "r3" },
        ],
        background: null,
      },
      [w("a", 1000, 1100), w("b", 2000, 2100), w("c", 3000, 3100), w("d", 4000, 4100)],
      [{ startMs: 1500, endMs: 2500, reason: "Pause" }],
      60_000,
    );
    const cuts = r.ok ? r.data.cuts : [];
    expect(cuts.length).toBeGreaterThan(0);
    const sorted = [...cuts].sort((a, b) => a.startMs - b.startMs);
    sorted.slice(1).forEach((c, i) => expect(c.startMs).toBeGreaterThanOrEqual(sorted[i]!.endMs));
  });

  it("refuses the answer when the merge drops the only item", () => {
    const r = validateAiEdit(
      {
        ...empty,
        wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "r" }],
        background: null,
      },
      [w("a", 0, 100), w("b", 1000, 1100), w("c", 1900, 2000)],
      [{ startMs: 1500, endMs: 30_000, reason: "Long" }],
      60_000,
    );
    expect(r).toEqual({ ok: false, error: "invalid" });
  });

  it("accepts a good fix and drops bad ones", () => {
    const d = data({
      fixes: [
        { index: 5, old: "Jon", new: "John", reason: "Name said earlier" },
        { index: 5, old: "Jon", new: "Johan", reason: "repeat index" },
        { index: 4, old: "WRONG", new: "was", reason: "old differs" },
        { index: 3, old: "name", new: "name", reason: "same" },
        { index: 3, old: "name", new: " ", reason: "empty" },
        { index: 2, old: "my", new: "x".repeat(41), reason: "too long" },
        { index: 2, old: "my", new: "May", reason: "" },
        { index: 1, old: "um", new: "Um", reason: "filler" },
        { index: 99, old: "x", new: "y", reason: "range" },
      ],
      keepPauses: [
        { candidate: 0, reason: "a" },
        { candidate: 1, reason: "b" },
      ],
      wordCuts: [
        { fromWord: 2, toWord: 3, kind: "false_start", reason: "a" },
        { fromWord: 4, toWord: 4, kind: "false_start", reason: "b" },
        { fromWord: 6, toWord: 6, kind: "false_start", reason: "c" },
        { fromWord: 7, toWord: 7, kind: "false_start", reason: "d" },
        { fromWord: 8, toWord: 8, kind: "false_start", reason: "e" },
      ],
    });
    expect(d.fixes).toEqual([{ index: 5, old: "Jon", new: "John", reason: "Name said earlier" }]);
    expect(d.dropped).toBe(8);
  });

  it("caps reasons at 280 characters", () => {
    const d = data({ keepPauses: [{ candidate: 0, reason: "r".repeat(500) }] });
    expect(d.cuts[0]?.reason).toHaveLength(AI_EDIT.reasonMax);
  });

  it("keeps a background in the catalog and drops others (counted)", () => {
    expect(data({ background: { id: "bg1", reason: "Warm" } }).background).toEqual({
      id: "bg1",
      reason: "Warm",
    });
    const d = data({
      keepPauses: [
        { candidate: 0, reason: "a" },
        { candidate: 1, reason: "b" },
      ],
      background: { id: "nope", reason: "Warm" },
    });
    expect(d.background).toBeNull();
    expect(d.dropped).toBe(1);
  });

  it("refuses the whole answer when word cuts take over 40% of a take of 30 s or longer", () => {
    const words = [w("a", 0, 100), w("b", 100, 200), w("c", 12_300, 12_400)];
    const answer = {
      ...empty,
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start" as const, reason: "x" }],
    };
    expect(validateAiEdit(answer, words, [], 30_000)).toEqual({ ok: false, error: "invalid" }); // 40.3 %
    expect(validateAiEdit(answer, words, [], 31_000).ok).toBe(true); // 39.0 %
  });

  it("picks the cap from the take length: 60% under 30 s, 40% from 30 s (C-42)", () => {
    expect(wordCutMaxShareFor(29_999)).toBe(0.6);
    expect(wordCutMaxShareFor(30_000)).toBe(0.4);
    expect(wordCutMaxShareFor(12_300)).toBe(0.6);
    expect(wordCutMaxShareFor(120_000)).toBe(0.4);
  });

  it("lets a take under 30 s lose up to 60% to word cuts and refuses past it", () => {
    // One cut from 100 to 3000 ms: 2900 ms. Take length 5000 ms gives 58%, 4800 ms gives 60.4%.
    const words = [w("a", 0, 100), w("b", 100, 200), w("c", 3000, 3100)];
    const answer = {
      ...empty,
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start" as const, reason: "x" }],
    };
    expect(validateAiEdit(answer, words, [], 5000).ok).toBe(true);
    expect(validateAiEdit(answer, words, [], 4800)).toEqual({ ok: false, error: "invalid" });
  });

  it("keeps 40% for a take of 30 s or longer, and 60% applies only just under it", () => {
    // 13 000 ms of cuts: 43.3% of 30 000 ms (refused), but 43.4% of 29 999 ms (kept).
    const words = [w("a", 0, 100), w("b", 100, 200), w("c", 13_100, 13_200)];
    const answer = {
      ...empty,
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start" as const, reason: "x" }],
    };
    expect(validateAiEdit(answer, words, [], 30_000)).toEqual({ ok: false, error: "invalid" });
    expect(validateAiEdit(answer, words, [], 29_999).ok).toBe(true);
    expect(validateAiEdit(answer, words, [], 32_600).ok).toBe(true); // 39.9%
  });

  it("refuses the answer when more than half of the items are dropped, not at exactly half", () => {
    const half = run({
      keepPauses: [
        { candidate: 0, reason: "a" },
        { candidate: 9, reason: "b" },
      ],
    });
    expect(half.ok).toBe(true);
    const over = run({
      keepPauses: [
        { candidate: 0, reason: "a" },
        { candidate: 9, reason: "b" },
      ],
      fixes: [{ index: 0, old: "bad", new: "x", reason: "r" }],
    });
    expect(over).toEqual({ ok: false, error: "invalid" });
  });

  it("an answer with nothing in it is valid: every pause is cut", () => {
    expect(run({}).ok).toBe(true);
  });

  it("drops a word cut that overlaps an earlier word cut", () => {
    const d = data({
      keepPauses: [
        { candidate: 0, reason: "a" },
        { candidate: 1, reason: "b" },
      ],
      wordCuts: [
        { fromWord: 2, toWord: 3, kind: "false_start", reason: "a" },
        { fromWord: 3, toWord: 4, kind: "false_start", reason: "b" },
        { fromWord: 8, toWord: 8, kind: "false_start", reason: "c" },
      ],
    });
    expect(d.dropped).toBe(1);
  });

  it("never returns overlapping cuts", () => {
    const d = data({
      wordCuts: [
        { fromWord: 4, toWord: 4, kind: "false_start", reason: "a" },
        { fromWord: 7, toWord: 7, kind: "false_start", reason: "b" },
      ],
    });
    const cuts = [...d.cuts].sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i]!.startMs).toBeGreaterThanOrEqual(cuts[i - 1]!.endMs);
    }
  });
});
