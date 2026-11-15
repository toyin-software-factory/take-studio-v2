import { describe, expect, it } from "vitest";
import {
  type AiCandidate,
  type AiEditAnswer,
  type AiWord,
  buildAiRequest,
  validateAiEdit,
} from "./ai-edit";
import { w } from "./ai-edit-test-helpers";

// ----- Cut quality fixture 1 (B2-T27, first case of the C-37 test set) -----
// Made up words and times that copy the pattern of a real report: a drawn out "uh" inside a
// sentence, an "um" with a gap after it, a stutter said twice (each as two "my" words: the first
// is cut, the second is the clean copy), and a tic. Not anyone's take.
const HESITATION: AiWord[] = [
  w("So", 1000, 1200), //                0
  w("it's,", 1250, 1500), //             1
  w("uh", 1550, 2450, true), //          2  drawn out hesitation (0.9 s)
  w("checking", 2500, 2900), //          3
  w("to", 2950, 3050), //                4
  w("my", 3100, 3250), //                5  first stutter, first copy (cut)
  w("my", 3300, 3500), //                6  first stutter, clean copy (kept)
  w("check", 3550, 3800), //             7
  w("this", 3850, 4100), //              8
  w("make", 5000, 5200), //              9
  w("sure", 5250, 5500), //              10
  w("that", 5550, 5700), //              11
  w("my", 5750, 5900), //                12 second stutter, first copy (cut)
  w("my", 5950, 6100), //                13 second stutter, clean copy (kept)
  w("it", 6150, 6250), //                14
  w("works", 6300, 6700), //             15
  w("if", 7000, 7100), //                16
  w("it's,", 7150, 7400), //             17
  w("um", 7450, 7700, true), //          18 hesitation with a 0.7 s gap after it
  w("you", 8400, 8500), //               19
  w("know", 8550, 8900), //              20 tic
  w("thanks", 9000, 9500), //            21
];
const HESITATION_CANDS: AiCandidate[] = [
  { startMs: 4100, endMs: 5000, reason: "Pause of 0.9 s" },
  { startMs: 7700, endMs: 8400, reason: "Pause of 0.7 s" },
];
const HESITATION_ANSWER: AiEditAnswer = {
  keepPauses: [],
  fixes: [],
  background: null,
  wordCuts: [
    { fromWord: 2, toWord: 2, kind: "filler", reason: "Hesitation sound" },
    { fromWord: 5, toWord: 5, kind: "false_start", reason: "Stutter" },
    { fromWord: 12, toWord: 12, kind: "false_start", reason: "Stutter" },
    { fromWord: 18, toWord: 18, kind: "filler", reason: "Hesitation sound" },
    { fromWord: 19, toWord: 20, kind: "filler", reason: "Verbal tic" },
  ],
};
describe("cut quality fixture 1: hesitation sounds and both stutters", () => {
  const req = buildAiRequest({
    words: HESITATION,
    candidates: HESITATION_CANDS,
    durationMs: 12_000,
  });

  it("tells the model to cut every hesitation sound and every stutter, not only the first", () => {
    const system = req.system.toLowerCase();
    expect(system).toContain("hesitation sounds (uh, um");
    expect(system).toContain("never content: cut every one");
    expect(system).toContain("including a long drawn out one");
    expect(system).toContain("cut every time it happens");
    expect(system).toContain("sort of, kind of, basically, you know");
    expect(system).toContain("what kind of soil");
    expect(system).toContain("i like that rule");
    expect(system).toContain("never an earlier attempt");
    expect(system).toContain("to the end");
    // The old blanket line made the model keep the sounds and the first stutter.
    expect(system).not.toContain("when in doubt, keep it");
  });

  it("lists the hesitation words flagged and both stutters in the request", () => {
    expect(req.user).toContain("2|uh|1550|2450|f");
    expect(req.user).toContain("18|um|7450|7700|f");
    expect(req.user).toContain("5|my|3100|3250|\n6|my|3300|3500|");
    expect(req.user).toContain("12|my|5750|5900|\n13|my|5950|6100|");
  });

  it("keeps every cut of the right answer, cuts nothing meaningful, and stays under the cap", () => {
    const r = validateAiEdit(HESITATION_ANSWER, HESITATION, HESITATION_CANDS, 12_000);
    if (!r.ok) throw new Error("expected valid");
    expect(r.data.dropped).toBe(0);
    const cut = (i: number) =>
      r.data.cuts.some(
        (c) =>
          c.applied !== false &&
          c.startMs <= (HESITATION[i]?.startMs ?? -1) &&
          c.endMs >= (HESITATION[i]?.endMs ?? 0),
      );
    for (const i of [2, 5, 12, 18, 19, 20]) expect(cut(i)).toBe(true);
    for (const i of [0, 1, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 21]) {
      expect(cut(i)).toBe(false);
    }
  });
});
describe("unclear words (B2-T50)", () => {
  const base = { startMs: 0, endMs: 300, filler: false };
  const build = (words: Parameters<typeof buildAiRequest>[0]["words"]) =>
    buildAiRequest({ words, candidates: [], durationMs: 1000 }).user.split("\n");

  it("marks a word under the confidence threshold with u, and leaves a clear word plain", () => {
    const lines = build([
      { ...base, w: "Wow.", conf: 0.31 },
      { ...base, w: "Today", conf: 0.99 },
      { ...base, w: "um", filler: true, conf: 0.4 },
      { ...base, w: "plain" },
    ]);
    expect(lines.filter((l) => /^\d+\|/.test(l)).slice(0, 4)).toEqual([
      "0|Wow.|0|300|u",
      "1|Today|0|300|",
      "2|um|0|300|fu",
      "3|plain|0|300|",
    ]);
  });

  it("tells the model what u means, and still never sends the confidence number", () => {
    const request = buildAiRequest({
      words: [{ ...base, w: "Wow.", conf: 0.31 }],
      candidates: [],
      durationMs: 1000,
    });
    expect(request.system).toContain("A u flag means the transcriber was unsure");
    expect(request.user).not.toContain("0.31");
  });
});
