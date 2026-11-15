import { type AiCandidate, type AiEditAnswer, type AiWord, validateAiEdit } from "./ai-edit";

export const w = (text: string, startMs: number, endMs: number, filler = false): AiWord => ({
  w: text,
  startMs,
  endMs,
  filler,
});
// 0 Hello 1 um 2 my 3 name 4 is 5 Jon 6 and 7 I 8 build
export const WORDS: AiWord[] = [
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
export const DURATION = 10_000;
export const CANDS: AiCandidate[] = [
  { startMs: 2100, endMs: 3900, reason: "Pause of 1.8 s" },
  { startMs: 5100, endMs: 9900, reason: "Pause of 4.8 s" },
];
export const empty: AiEditAnswer = { keepPauses: [], wordCuts: [], fixes: [], background: null };
export const run = (a: Partial<AiEditAnswer>, words = WORDS, cands = CANDS) =>
  validateAiEdit({ ...empty, ...a }, words, cands, DURATION, [
    { id: "bg1", name: "Loft", alt: "A loft" },
  ]);
export const data = (a: Partial<AiEditAnswer>) => {
  const r = run(a);
  if (!r.ok) throw new Error("expected valid");
  return r.data;
};
