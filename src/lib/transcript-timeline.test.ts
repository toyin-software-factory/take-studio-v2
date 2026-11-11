import { describe, expect, it } from "vitest";
import {
  buildCues,
  toPlainText,
  toSrt,
  toTrimmedTranscript,
  toVtt,
  type StoredWord,
  type TrimmedParagraph,
  type TrimmedWord,
} from "./transcript-timeline";
import { alignToFrames, keepRanges, TRIM } from "./trim";

const word = (w: string, startMs: number, endMs: number, extra: Partial<StoredWord> = {}) => ({
  w,
  startMs,
  endMs,
  filler: false,
  para: false,
  ...extra,
});
const base = { durationMs: 20_000, sourceFps: 30 } as const;
const trimmedWord = (w: string, startMs: number, endMs: number, filler = false): TrimmedWord => ({
  w,
  startMs,
  endMs,
  filler,
});
const one = (...words: TrimmedWord[]): TrimmedParagraph[] => [
  { startMs: words[0]?.startMs ?? 0, words },
];

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
          { w: "Hello", startMs: 500, endMs: 900, filler: false },
          { w: "there.", startMs: 900, endMs: 1400, filler: false },
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
    expect(out[0]?.words[0]).toEqual({ w: "edge", startMs: 4700, endMs: 5000, filler: false });
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

describe("buildCues", () => {
  it("drops fillers", () => {
    const cues = buildCues(one(trimmedWord("um", 0, 300, true), trimmedWord("Hello.", 300, 900)));
    expect(cues).toEqual([{ startMs: 300, endMs: 1300, text: "Hello." }]);
  });

  it("makes no cue from fillers alone", () => {
    expect(buildCues(one(trimmedWord("uh", 0, 300, true)))).toEqual([]);
  });

  it("starts a new cue at a paragraph start, even when the first word is a filler", () => {
    const cues = buildCues([
      { startMs: 0, words: [trimmedWord("First", 0, 400), trimmedWord("part", 400, 800)] },
      {
        startMs: 2000,
        words: [trimmedWord("um", 2000, 2200, true), trimmedWord("Second", 2200, 2600)],
      },
    ]);
    expect(cues.map((c) => c.text)).toEqual(["First part", "Second"]);
  });

  it("breaks after a word that ends a sentence", () => {
    const cues = buildCues(
      one(
        trimmedWord("One.", 0, 400),
        trimmedWord("Two?", 400, 800),
        trimmedWord("Three!", 800, 1200),
        trimmedWord("Four", 1200, 1600),
      ),
    );
    expect(cues.map((c) => c.text)).toEqual(["One.", "Two?", "Three!", "Four"]);
  });

  it("breaks after a sentence end that is followed by a closing quote or bracket", () => {
    const cues = buildCues(one(trimmedWord('said."', 0, 400), trimmedWord("Next", 400, 800)));
    expect(cues).toHaveLength(2);
  });

  it("does not break after an abbreviation style comma or colon", () => {
    const cues = buildCues(one(trimmedWord("Well,", 0, 400), trimmedWord("yes:", 400, 800)));
    expect(cues).toHaveLength(1);
  });

  it("wraps onto two balanced lines of at most 42 characters", () => {
    const words = "this is a fairly long caption that needs two lines to fit".split(" ");
    let at = 0;
    const cues = buildCues(
      one(
        ...words.map((w) => {
          const t = trimmedWord(w, at, at + 200);
          at += 200;
          return t;
        }),
      ),
    );
    expect(cues).toHaveLength(1);
    const lines = cues[0]?.text.split("\n") ?? [];
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(42));
    expect(Math.abs((lines[0]?.length ?? 0) - (lines[1]?.length ?? 0))).toBeLessThanOrEqual(8);
    expect(lines.join(" ")).toBe(words.join(" "));
  });

  it("starts a new cue before the text would not fit on two lines of 42 characters", () => {
    const words = Array.from({ length: 24 }, (_, i) => `word${String(i).padStart(2, "0")}`);
    let at = 0;
    const cues = buildCues(
      one(
        ...words.map((w) => {
          const t = trimmedWord(w, at, at + 150);
          at += 150;
          return t;
        }),
      ),
    );
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      const lines = cue.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(42));
    }
    expect(cues.flatMap((c) => c.text.split(/\s+/))).toEqual(words);
  });

  it("starts a new cue before one passes 7 seconds", () => {
    const words = Array.from({ length: 12 }, (_, i) => trimmedWord("go", i * 1000, i * 1000 + 900));
    const cues = buildCues(one(...words));
    expect(cues.length).toBeGreaterThan(1);
    cues.forEach((c) => expect(c.endMs - c.startMs).toBeLessThanOrEqual(7000));
  });

  it("caps a single very long word at 7 seconds", () => {
    const cues = buildCues(one(trimmedWord("looong", 0, 12_000)));
    expect(cues[0]).toMatchObject({ startMs: 0, endMs: 7000 });
  });

  it("keeps a word longer than a line on one line instead of failing", () => {
    const giant = "x".repeat(60);
    const cues = buildCues(one(trimmedWord(giant, 0, 800)));
    expect(cues[0]?.text).toBe(giant);
  });

  it("stretches a short cue to 1 second when the next cue starts late enough", () => {
    const cues = buildCues(one(trimmedWord("Hi.", 0, 300), trimmedWord("Later", 5000, 5400)));
    expect(cues[0]).toMatchObject({ startMs: 0, endMs: 1000 });
    expect(cues[1]).toMatchObject({ startMs: 5000, endMs: 6000 });
  });

  it("does not stretch past the next cue", () => {
    const cues = buildCues(one(trimmedWord("Hi.", 0, 300), trimmedWord("Yes.", 600, 900)));
    expect(cues[0]?.endMs).toBe(600);
    expect(cues[1]?.startMs).toBe(600);
  });

  it("never overlaps, even when the words do", () => {
    const cues = buildCues(
      one(
        trimmedWord("One.", 0, 1500),
        trimmedWord("Two.", 1000, 2500),
        trimmedWord("Three.", 1200, 3500),
      ),
    );
    cues.forEach((c, i) => {
      expect(c.endMs).toBeGreaterThan(c.startMs);
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(cues[i - 1]?.endMs ?? 0);
    });
  });

  it("cleans odd characters out of the text", () => {
    const cues = buildCues(one(trimmedWord("a  b", 0, 400), trimmedWord("-->", 400, 800)));
    expect(cues[0]?.text).toBe("a b ->");
  });
});

describe("toSrt and toVtt", () => {
  const cues = [
    { startMs: 500, endMs: 3_723_004, text: "Hello there,\nfriend." },
    { startMs: 4000, endMs: 5000, text: "Tom & <Jerry>" },
  ];

  it("writes SubRip with numbers from 1 and comma times", () => {
    expect(toSrt(cues)).toBe(
      "1\n00:00:00,500 --> 01:02:03,004\nHello there,\nfriend.\n\n" +
        "2\n00:00:04,000 --> 00:00:05,000\nTom & <Jerry>\n\n",
    );
  });

  it("writes WebVTT with a header, dot times and escaped text", () => {
    expect(toVtt(cues)).toBe(
      "WEBVTT\n\n00:00:00.500 --> 01:02:03.004\nHello there,\nfriend.\n\n" +
        "00:00:04.000 --> 00:00:05.000\nTom &amp; &lt;Jerry&gt;\n\n",
    );
  });

  it("gives an SRT and a VTT with the same cue times and text from the same words", () => {
    const made = buildCues(
      one(
        trimmedWord("Same", 100, 500),
        trimmedWord("words.", 500, 1100),
        trimmedWord("Again", 1500, 2000),
      ),
    );
    const srtTimes = [
      ...toSrt(made).matchAll(/(\d\d:\d\d:\d\d),(\d{3}) --> (\d\d:\d\d:\d\d),(\d{3})/g),
    ];
    const vttTimes = [
      ...toVtt(made).matchAll(/(\d\d:\d\d:\d\d)\.(\d{3}) --> (\d\d:\d\d:\d\d)\.(\d{3})/g),
    ];
    expect(srtTimes.map((m) => m.slice(1).join("|"))).toEqual(
      vttTimes.map((m) => m.slice(1).join("|")),
    );
    expect(srtTimes).toHaveLength(made.length);
  });

  it("is empty for no cues (VTT keeps its header)", () => {
    expect(toSrt([])).toBe("");
    expect(toVtt([])).toBe("WEBVTT\n\n");
  });
});

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
