import { describe, expect, it } from "vitest";
import {
  type AiCandidate,
  type AiEditAnswer,
  type AiWord,
  AI_EDIT,
  aiEditAnswerSchema,
  buildAiRequest,
  validateAiEdit,
} from "./ai-edit";

const w = (text: string, startMs: number, endMs: number, filler = false): AiWord => ({
  w: text,
  startMs,
  endMs,
  filler,
});
// 0 Hello 1 um 2 my 3 name 4 is 5 Jon 6 and 7 I 8 build
const WORDS: AiWord[] = [
  w("Hello", 0, 400),
  w("um", 500, 700, true),
  w("my", 800, 1000),
  w("name", 1100, 1400),
  w("is", 1500, 1600),
  w("Jon", 1700, 2000),
  w("and", 4000, 4200),
  w("I", 4300, 4400),
  w("build", 4500, 5000),
];
const DURATION = 10_000;
const CANDS: AiCandidate[] = [
  { startMs: 2100, endMs: 3900, reason: "Pause of 1.8 s" },
  { startMs: 5100, endMs: 9900, reason: "Pause of 4.8 s" },
];
const empty: AiEditAnswer = { keepPauses: [], wordCuts: [], fixes: [], background: null };
const run = (a: Partial<AiEditAnswer>, words = WORDS, cands = CANDS) =>
  validateAiEdit({ ...empty, ...a }, words, cands, DURATION, [
    { id: "bg1", name: "Loft", alt: "A loft" },
  ]);
const data = (a: Partial<AiEditAnswer>) => {
  const r = run(a);
  if (!r.ok) throw new Error("expected valid");
  return r.data;
};

describe("buildAiRequest (AC-8)", () => {
  const req = buildAiRequest({ words: WORDS, candidates: CANDS, durationMs: DURATION });
  it("lists words in the compact line form and the candidates", () => {
    expect(req.user).toContain("0|Hello|0|400|\n1|um|500|700|f\n");
    expect(req.user).toContain("PAUSES\n0|2100|3900\n1|5100|9900");
    expect(req.user).toContain("TAKE_LENGTH_MS 10000");
    expect(req.user).not.toContain("BACKGROUNDS");
  });
  it("cannot leak what it is never given", () => {
    const text = `${req.system}\n${req.user}`;
    for (const needle of ["@", "http", "title", "uuid", "creator"]) {
      expect(text.toLowerCase()).not.toContain(needle === "title" ? "take title" : needle);
    }
  });
  it("keeps a pipe or line break in a word from breaking its line", () => {
    const r = buildAiRequest({ words: [w("a|b\nc", 0, 1)], candidates: [], durationMs: 5 });
    expect(r.user).toContain("0|a b c|0|1|");
  });
  it("lists the catalog when given one", () => {
    const r = buildAiRequest({
      words: [],
      candidates: [],
      durationMs: 5,
      catalog: [{ id: "x", name: "Loft", alt: "A loft" }],
    });
    expect(r.user).toContain("BACKGROUNDS\nx|Loft|A loft");
  });
  it("estimates a 10 minute take well under the guard", () => {
    const many = Array.from({ length: 1500 }, (_, i) => w("word", i * 400, i * 400 + 300));
    const big = buildAiRequest({ words: many, candidates: [], durationMs: 600_000 });
    expect(big.estimatedInputTokens).toBeLessThan(AI_EDIT.maxInputTokens);
  });
});

describe("aiEditAnswerSchema", () => {
  it("accepts the shape and rejects others", () => {
    expect(aiEditAnswerSchema.safeParse(empty).success).toBe(true);
    expect(aiEditAnswerSchema.safeParse({ keepPauses: [] }).success).toBe(false);
    expect(aiEditAnswerSchema.safeParse({ ...empty, background: undefined }).success).toBe(false);
  });
});

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

  it("places a word cut from the first word's start to the next word's start", () => {
    const d = data({
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "filler", reason: "Filler word" }],
    });
    expect(d.cuts).toContainEqual(
      expect.objectContaining({ startMs: 500, endMs: 800, kind: "filler", applied: true }),
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
      expect.objectContaining({ startMs: 9000, endMs: 10_000, kind: "false_start" }),
    ]);
  });

  it("ends a word cut at a kept pause that starts inside it", () => {
    const d = data({
      keepPauses: [{ candidate: 0, reason: "Beat" }],
      wordCuts: [{ fromWord: 5, toWord: 5, kind: "false_start", reason: "Restart" }],
    });
    const wc = d.cuts.find((c) => c.kind === "false_start");
    expect(wc).toMatchObject({ startMs: 1700, endMs: 2100 });
    expect(d.cuts.find((c) => c.applied === false)).toMatchObject({ startMs: 2100 });
  });

  it("merges a word cut with the cut pause it overlaps, keeping the word cut's kind and reason", () => {
    const d = data({
      wordCuts: [{ fromWord: 5, toWord: 5, kind: "false_start", reason: "Restart" }],
    });
    expect(d.cuts[0]).toMatchObject({
      startMs: 1700,
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

  it("drops a filler cut over a word that is not a filler, accepts isFillerWord matches", () => {
    const words = [w("Um,", 0, 100, false), w("so", 200, 300), w("fine", 400, 500)];
    const ok = validateAiEdit(
      {
        ...empty,
        wordCuts: [{ fromWord: 0, toWord: 0, kind: "filler", reason: "um" }],
        fixes: [{ index: 2, old: "fine", new: "Fine.", reason: "caps" }],
      },
      words,
      [],
      1000,
    );
    expect(ok.ok && ok.data.cuts).toHaveLength(1);
    const bad = validateAiEdit(
      {
        ...empty,
        keepPauses: [],
        wordCuts: [
          { fromWord: 1, toWord: 1, kind: "filler", reason: "no" },
          { fromWord: 2, toWord: 2, kind: "false_start", reason: "ok" },
        ],
        fixes: [{ index: 0, old: "Um,", new: "Um.", reason: "ok" }],
      },
      words,
      [],
      1000,
    );
    // 1 of 2 cuts + 1 fix on a filler = 2 of 3 dropped: whole answer refused
    expect(bad).toEqual({ ok: false, error: "invalid" });
  });

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

  it("refuses the whole answer when word cuts take over 25% of the take", () => {
    const words = [w("a", 0, 100), w("b", 100, 200), w("c", 3000, 3100)];
    const r = validateAiEdit(
      { ...empty, wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "x" }] },
      words,
      [],
      10_000,
    ); // 100..3000 = 2900 ms of 10 000 = 29 %
    expect(r).toEqual({ ok: false, error: "invalid" });
    const fine = validateAiEdit(
      { ...empty, wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "x" }] },
      words,
      [],
      12_000,
    ); // 24.2 %
    expect(fine.ok).toBe(true);
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
