export type TrimmedWord = {
  /** Index into `transcript.words` (spec 0012): matches a visible word to its fix. */
  readonly index: number;
  readonly w: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly filler: boolean;
};

export type TrimmedParagraph = {
  readonly startMs: number;
  readonly words: readonly TrimmedWord[];
};

export type Cue = {
  readonly startMs: number;
  readonly endMs: number;
  /** One or two lines joined by a line feed. */
  readonly text: string;
};

export const CAPTION_RULES = {
  maxCueMs: 7000,
  minCueMs: 1000,
  maxLines: 2,
  maxLineChars: 42,
} as const;
