/**
 * Shared transcript rules (spec 0007). Pure: the word shape stored in `transcript.words` and
 * the filler word list. Slice 5's AI editing reuses `FILLER_WORDS`.
 */

/**
 * One word as stored: times in milliseconds on the original upload (never the trimmed video),
 * `w` is the provider's punctuated word, `para` is true on the first word of a paragraph.
 */
export type TranscriptWord = {
  readonly w: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly conf: number;
  readonly filler: boolean;
  readonly para: boolean;
};

/** Words that count as filler, matched on the lower cased word without punctuation. */
export const FILLER_WORDS = ["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm"] as const;

/** True when `word` (any case, with or without punctuation) is a filler word. */
export function isFillerWord(word: string): boolean {
  const plain = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return (FILLER_WORDS as readonly string[]).includes(plain);
}
