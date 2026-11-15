import { type TrimmedWord } from "./transcript-timeline";
import type { TranscriptWord } from "./transcript-rules";

export const word = (
  w: string,
  startMs: number,
  endMs: number,
  extra: Partial<TranscriptWord> = {},
) => ({
  w,
  startMs,
  endMs,
  conf: 0.99,
  filler: false,
  para: false,
  ...extra,
});
export const base = { durationMs: 20_000, sourceFps: 30 } as const;
export const trimmedWord = (
  w: string,
  startMs: number,
  endMs: number,
  filler = false,
): TrimmedWord => ({
  index: 0,
  w,
  startMs,
  endMs,
  filler,
});
