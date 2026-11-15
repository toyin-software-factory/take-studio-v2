import { describe, expect, it } from "vitest";
import { toTrimmedTranscript } from "./transcript-timeline";
import { alignToFrames, keepRanges, TRIM } from "./trim";
import { base, word } from "./transcript-timeline-test-helpers";

describe("toTrimmedTranscript", () => {
  it("is the same transcript when nothing was removed", () => {
    const out = toTrimmedTranscript(
      [word("Hello", 500, 900, { para: true }), word("there.", 900, 1400)],
      { ...base, removedRanges: [] },
    );
    expect(out).toEqual([
      {
        startMs: 500,
        words: [
          { index: 0, w: "Hello", startMs: 500, endMs: 900, filler: false },
          { index: 1, w: "there.", startMs: 900, endMs: 1400, filler: false },
        ],
      },
    ]);
  });

  it("drops words inside a removed range and shifts the words after it", () => {
    const out = toTrimmedTranscript(
      [
        word("one", 1000, 1400, { para: true }),
        word("lost", 4000, 4400), // inside the cut
        word("two", 6000, 6400),
      ],
      { ...base, removedRanges: [{ startMs: 3000, endMs: 5000 }] },
    );
    const words = out.flatMap((p) => p.words);
    expect(words.map((w) => w.w)).toEqual(["one", "two"]);
    // 6000 ms on the original is 4000 ms on the trimmed video (2000 ms removed before it).
    expect(words[1]).toMatchObject({ startMs: 4000, endMs: 4400 });
  });

  it("uses the midpoint at the edge of a range", () => {
    const cut = [{ startMs: 5000, endMs: 6000 }];
    const out = (s: number, e: number) =>
      toTrimmedTranscript([word("w", s, e, { para: true })], { ...base, removedRanges: cut })
        .flatMap((p) => p.words)
        .map((w) => w.w);
    expect(out(4800, 5100)).toEqual(["w"]); // midpoint 4950, kept
    expect(out(4900, 5300)).toEqual([]); // midpoint 5100, inside the cut
    expect(out(5700, 6200)).toEqual([]); // midpoint 5950, inside the cut
    expect(out(5900, 6300)).toEqual(["w"]); // midpoint 6100, kept
    expect(out(5500, 6500)).toEqual(["w"]); // midpoint 6000, the cut is half open: kept
  });

  it("clamps a word that straddles a cut to its own keep range", () => {
    const out = toTrimmedTranscript([word("edge", 4700, 5200, { para: true })], {
      ...base,
      removedRanges: [{ startMs: 5000, endMs: 7000 }],
    });
    // Midpoint 4950 is kept; the end is cut off at 5000 and not stretched across the cut.
    expect(out[0]?.words[0]).toEqual({
      index: 0,
      w: "edge",
      startMs: 4700,
      endMs: 5000,
      filler: false,
    });
  });

  it("keeps every end after its start and never goes backwards", () => {
    const out = toTrimmedTranscript(
      [
        word("a", 1000, 1500, { para: true }),
        word("b", 1200, 1300), // overlaps a
        word("c", 1300, 1300), // zero length
      ],
      { ...base, removedRanges: [] },
    );
    const words = out.flatMap((p) => p.words);
    words.forEach((w, i) => {
      expect(w.endMs).toBeGreaterThan(w.startMs);
      if (i > 0) expect(w.startMs).toBeGreaterThanOrEqual(words[i - 1]?.startMs ?? 0);
    });
  });

  it("starts a paragraph at its first kept word and drops an empty paragraph", () => {
    const out = toTrimmedTranscript(
      [
        word("gone", 3200, 3600, { para: true }), // cut
        word("kept", 5200, 5600), // same paragraph, first kept word
        word("also", 3700, 3900, { para: true }), // second paragraph, cut
        word("last", 8000, 8400, { para: true }),
      ],
      { ...base, removedRanges: [{ startMs: 3000, endMs: 5000 }] },
    );
    expect(out.map((p) => p.words.map((w) => w.w))).toEqual([["kept"], ["last"]]);
    expect(out[0]?.startMs).toBe(out[0]?.words[0]?.startMs);
    // Times are not required to be sorted in the input; paragraphs follow the input order.
  });

  it("keeps each word's own time when the input is out of order", () => {
    const out = toTrimmedTranscript(
      [
        word("late", 9000, 9400),
        word("early", 1000, 1400, { para: true }),
        word("middle", 5000, 5400),
      ],
      { ...base, removedRanges: [] },
    );
    const time = new Map(out.flatMap((p) => p.words).map((w) => [w.w, w.startMs]));
    expect(Object.fromEntries(time)).toEqual({ late: 9000, early: 1000, middle: 5000 });
  });

  it("keeps each word in its paragraph when the input is out of order", () => {
    const out = toTrimmedTranscript(
      [
        word("A", 1000, 1400, { para: true }),
        word("B", 9000, 9400),
        word("C", 5000, 5400, { para: true }),
        word("D", 9500, 9900),
      ],
      { ...base, removedRanges: [] },
    );
    expect(out.map((p) => p.words.map((w) => w.w))).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
    expect(out.map((p) => p.startMs)).toEqual([1000, 5000]);
  });

  it("treats the first word as a paragraph start even when it is not flagged", () => {
    const out = toTrimmedTranscript([word("a", 100, 300), word("b", 300, 500)], {
      ...base,
      removedRanges: [],
    });
    expect(out).toHaveLength(1);
  });

  it("returns nothing when every word is removed", () => {
    const out = toTrimmedTranscript(
      [word("a", 1000, 1400, { para: true }), word("b", 1500, 1900)],
      { ...base, removedRanges: [{ startMs: 0, endMs: 20_000 }] },
    );
    expect(out).toEqual([]);
  });

  it("returns nothing for no words or a zero length take", () => {
    expect(toTrimmedTranscript([], { ...base, removedRanges: [] })).toEqual([]);
    expect(
      toTrimmedTranscript([word("a", 0, 100)], { durationMs: 0, sourceFps: 30, removedRanges: [] }),
    ).toEqual([]);
  });

  it("uses the same frame aligned keep ranges as the render, whatever the frame rate", () => {
    // 29.97 fps: the cut edges snap to frames, so a word right after the cut moves by the
    // aligned amount, not the raw one.
    const fps = 29.97;
    const removed = [{ startMs: 3010, endMs: 5020 }];
    const keep = alignToFrames(keepRanges(removed, 20_000), fps);
    const second = keep[1];
    expect(second).toBeDefined();
    const out = toTrimmedTranscript([word("after", 6000, 6400, { para: true })], {
      durationMs: 20_000,
      sourceFps: fps,
      removedRanges: removed,
    });
    const expectedStart = Math.round((keep[0]?.endMs ?? 0) + (6000 - (second?.startMs ?? 0)));
    expect(out[0]?.words[0]?.startMs).toBe(expectedStart);
  });

  it("assumes 30 fps when the frame rate is unknown, like the render", () => {
    const removed = [{ startMs: 3010, endMs: 5020 }];
    const keep = alignToFrames(keepRanges(removed, 20_000), null);
    const out = toTrimmedTranscript([word("after", 6000, 6400, { para: true })], {
      durationMs: 20_000,
      sourceFps: null,
      removedRanges: removed,
    });
    const expectedStart = Math.round((keep[0]?.endMs ?? 0) + (6000 - (keep[1]?.startMs ?? 0)));
    expect(out[0]?.words[0]?.startMs).toBe(expectedStart);
  });

  it("does not drift over a long take with many cuts", () => {
    // 9 minutes, a 1.5 second pause removed every 10 seconds (53 cuts).
    const durationMs = 540_000;
    const removed = Array.from({ length: 53 }, (_, i) => ({
      startMs: 10_000 * (i + 1) - 1500,
      endMs: 10_000 * (i + 1),
    }));
    expect(removed.length + 1).toBeLessThanOrEqual(TRIM.maxSegments);
    const fps = 25;
    const keep = alignToFrames(keepRanges(removed, durationMs), fps);
    const total = keep.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
    // One word in the middle of every kept stretch, plus one at the very end.
    const words = keep.map((r, i) =>
      word(`w${i}`, (r.startMs + r.endMs) / 2 - 100, (r.startMs + r.endMs) / 2 + 100, {
        para: i === 0,
      }),
    );
    const out = toTrimmedTranscript(words, { durationMs, sourceFps: fps, removedRanges: removed });
    const got = out.flatMap((p) => p.words);
    expect(got).toHaveLength(keep.length);
    let before = 0;
    keep.forEach((r, i) => {
      const middle = before + (r.endMs - r.startMs) / 2;
      expect(Math.abs((got[i]?.startMs ?? 0) - (middle - 100))).toBeLessThanOrEqual(1);
      before += r.endMs - r.startMs;
    });
    // The last word ends inside the trimmed video.
    expect(got[got.length - 1]?.endMs).toBeLessThanOrEqual(Math.ceil(total));
  });

  it("keeps filler words (the panel shows them)", () => {
    const out = toTrimmedTranscript(
      [word("um", 100, 300, { para: true, filler: true }), word("hi", 300, 600)],
      { ...base, removedRanges: [] },
    );
    expect(out[0]?.words.map((w) => w.filler)).toEqual([true, false]);
  });
});
