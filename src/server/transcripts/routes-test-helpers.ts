import type { TranscriptWord } from "@/lib/transcript-rules";

export const ORIGIN = "https://take-studio.example";
export const SECRET = "x".repeat(40);
export const w = (
  word: string,
  startMs: number,
  endMs: number,
  extra: Partial<TranscriptWord> = {},
): TranscriptWord => ({
  w: word,
  startMs,
  endMs,
  conf: 0.99,
  filler: false,
  para: false,
  ...extra,
});
// 20 s take; 3 s to 5.5 s is removed; "lost" is spoken inside the cut.
export const WORDS: TranscriptWord[] = [
  w("Um,", 300, 500, { para: true, filler: true }),
  w("Before", 500, 1000),
  w("the", 1000, 1200),
  w("pause.", 1200, 2800),
  w("lost", 3500, 4500),
  w("After", 5600, 6100, { para: true }),
  w("it.", 6100, 6600),
];
