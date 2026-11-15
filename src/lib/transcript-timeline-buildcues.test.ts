import { describe, expect, it } from "vitest";
import {
  buildCues,
  toSrt,
  toTrimmedTranscript,
  toVtt,
  type TrimmedParagraph,
  type TrimmedWord,
} from "./transcript-timeline";
import { base, trimmedWord, word } from "./transcript-timeline-test-helpers";

const one = (...words: TrimmedWord[]): TrimmedParagraph[] => [
  { startMs: words[0]?.startMs ?? 0, words },
];
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
describe("buildCues with interleaved paragraphs", () => {
  it("builds cues in mapped time order, so no cue is pushed past a later word", () => {
    const out = toTrimmedTranscript(
      [
        word("A", 1000, 1400, { para: true }),
        word("B", 9000, 9400),
        word("C", 5000, 5400, { para: true }),
        word("D", 9500, 9900),
      ],
      { ...base, removedRanges: [] },
    );
    const cues = buildCues(out);
    // C stays at 5000 ms (the second paragraph's own time); B and D follow it in time order.
    expect(cues.map((c) => [c.startMs, c.text])).toEqual([
      [1000, "A"],
      [5000, "C B D"],
    ]);
    cues.forEach((c, i) => {
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(cues[i - 1]?.endMs ?? 0);
    });
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
