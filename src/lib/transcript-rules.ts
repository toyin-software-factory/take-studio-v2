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

/**
 * One AI transcript fix (spec 0012, AC-4): the stored word at `index` reads `new` instead of
 * `old` unless the creator undid it. Personal data (text and reason): never log it.
 */
export type TranscriptEdit = {
  readonly index: number;
  readonly old: string;
  readonly new: string;
  readonly reason: string;
  readonly undone: boolean;
};

/**
 * The words as shown and exported: `new` for a fix that is not undone, else the stored `w`. Only
 * the text changes, so word count, order and timings stay. A fix whose `old` no longer matches
 * the word at its index (a stale edit) is ignored. Pure.
 */
export function editedWords(
  words: readonly TranscriptWord[],
  edits: readonly TranscriptEdit[],
): readonly TranscriptWord[] {
  if (edits.length === 0) return words;
  const live = new Map(edits.filter((e) => !e.undone).map((e) => [e.index, e] as const));
  return words.map((word, index) => {
    const edit = live.get(index);
    return edit && edit.old === word.w ? { ...word, w: edit.new } : word;
  });
}
