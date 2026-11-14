import { describe, expect, it } from "vitest";
import { deepgramUrl, isEnglish, parseDeepgramResponse } from "./deepgram";

const body = (over: Record<string, unknown> = {}, words?: unknown[], paragraphs?: unknown[]) => ({
  results: {
    channels: [
      {
        detected_language: "en",
        alternatives: [
          {
            transcript: "Hello there. Um so yes.",
            words: words ?? [
              { word: "hello", punctuated_word: "Hello", start: 0.1, end: 0.4, confidence: 0.99 },
              { word: "there", punctuated_word: "there.", start: 0.5, end: 0.9, confidence: 0.98 },
              { word: "um", punctuated_word: "Um", start: 2.0, end: 2.2, confidence: 0.8 },
              { word: "so", punctuated_word: "so", start: 2.3, end: 2.5, confidence: 0.9 },
            ],
            paragraphs: { paragraphs: paragraphs ?? [{ start: 0.1 }, { start: 2.0 }] },
          },
        ],
        ...over,
      },
    ],
  },
});

describe("parseDeepgramResponse (spec 0007)", () => {
  it("builds words in ms with fillers and paragraph starts", () => {
    const r = parseDeepgramResponse(body());
    expect(r.kind).toBe("words");
    if (r.kind !== "words") return;
    expect(r.text).toBe("Hello there. Um so yes.");
    expect(r.words.map((w) => [w.w, w.startMs, w.endMs, w.filler, w.para])).toEqual([
      ["Hello", 100, 400, false, true],
      ["there.", 500, 900, false, false],
      ["Um", 2000, 2200, true, true],
      ["so", 2300, 2500, false, false],
    ]);
  });

  it("opens only the first word's paragraph when there is no paragraphs block", () => {
    const b = body();
    delete (b.results.channels[0]!.alternatives[0] as { paragraphs?: unknown }).paragraphs;
    const r = parseDeepgramResponse(b);
    if (r.kind !== "words") throw new Error("expected words");
    expect(r.words.map((w) => w.para)).toEqual([true, false, false, false]);
  });

  it("falls back to the plain word without punctuation", () => {
    const r = parseDeepgramResponse(body({}, [{ word: "hi", start: 0, end: 1, confidence: 1 }]));
    if (r.kind !== "words") throw new Error("expected words");
    expect(r.words[0]?.w).toBe("hi");
  });

  it.each(["en-GB", "en-US", "en", "EN-au"])("treats %s as English", (code) => {
    expect(parseDeepgramResponse(body({ detected_language: code })).kind).toBe("words");
    expect(isEnglish(code)).toBe(true);
  });

  it.each(["es", "fr", "de-CH", "eno"])("treats %s as not English", (code) => {
    expect(parseDeepgramResponse(body({ detected_language: code })).kind).toBe("not_english");
  });

  it("reports no speech when there are no words", () => {
    expect(parseDeepgramResponse(body({}, [], [])).kind).toBe("no_speech");
  });

  it("rejects a response that fails the schema", () => {
    expect(parseDeepgramResponse({}).kind).toBe("invalid");
    expect(parseDeepgramResponse({ results: { channels: [] } }).kind).toBe("invalid");
    expect(parseDeepgramResponse(body({}, [{ word: "x", start: "a" }])).kind).toBe("invalid");
  });
});

describe("deepgramUrl", () => {
  it("sends the spec's options including mip_opt_out", () => {
    const q = new URL(deepgramUrl()).searchParams;
    const options = new URLSearchParams(q);
    options.delete("keyterm");
    expect(Object.fromEntries(options)).toEqual({
      model: "nova-3",
      detect_language: "true",
      smart_format: "true",
      punctuate: "true",
      paragraphs: "true",
      filler_words: "true",
      mip_opt_out: "true",
    });
  });

  it("asks for the placeholder words as keyterms, one parameter each", () => {
    const q = new URL(deepgramUrl()).searchParams;
    expect(q.getAll("keyterm")).toEqual(["blah blah", "la la la", "something something"]);
  });
});
