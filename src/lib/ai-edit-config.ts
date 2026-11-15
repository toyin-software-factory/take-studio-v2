import type { TranscriptWord } from "./transcript-rules";

/** AI editing settings and the shapes the request and the validation share (spec 0012). */

export const AI_EDIT = {
  model: "claude-opus-5-5",
  maxTokens: 8000,
  /** A request estimated over this is not sent (`too_large`). */
  maxInputTokens: 60_000,
  /** One deadline for the transcript and the AI step together (AC-6). */
  deadlineMs: 120_000,
  /** The stored maximum, applied through `cleanReason`. */
  reasonMax: 280,
  /** What the prompt asks for. */
  promptReasonMax: 120,
  fixMaxChars: 40,
  wordCutMaxMs: 20_000,
  /** Word cuts may remove at most this share of a take of `shortTakeMs` or longer. */
  wordCutMaxShare: 0.4,
  /** A take shorter than this gets the higher share below (C-42). */
  shortTakeMs: 30_000,
  shortTakeWordCutMaxShare: 0.6,
  /**
   * A take with a script (spec 0021 AC-13) may lose more: a script take is mostly repeated and
   * fluffed lines. Starts at 65% for every length; task 11's `ai-eval` run confirms it.
   */
  scriptWordCutMaxShare: 0.65,
  maxFixes: 300,
  /**
   * `claude-opus-5-5` rejects `thinking: {type: "disabled"}` (400), so thinking is left at its
   * default and `effort` is set to `low` instead. No streaming, no SDK retries (AC-9).
   */
  effort: "low",
  stream: false,
  sdkMaxRetries: 0,
  keptPauseReason: "Kept: deliberate pause",
} as const;

/**
 * The most the word cuts may remove, as a share of the take (C-42): 60% under 30 s, because a
 * short clip with a few retakes and filler can honestly lose more than 40%; 40% from 30 s on.
 * Pure.
 */
export function wordCutMaxShareFor(durationMs: number, hasScript = false): number {
  if (hasScript) return AI_EDIT.scriptWordCutMaxShare;
  return durationMs < AI_EDIT.shortTakeMs
    ? AI_EDIT.shortTakeWordCutMaxShare
    : AI_EDIT.wordCutMaxShare;
}

/** Why the AI edit fell back to the rules cuts (the Sentry `cause` tag). */
export const AI_CAUSES = [
  "timeout",
  "invalid",
  "cutoff",
  "provider_error",
  "provider_rejected",
  "no_key",
  "too_large",
  "transcript_failed",
] as const;
export type AiCause = (typeof AI_CAUSES)[number];

/** A rules pause candidate as the AI edit sees it. */
export type AiCandidate = {
  readonly startMs: number;
  readonly endMs: number;
  readonly reason: string;
};

/** A built in background as the request lists it (spec 0012 part 6 fills this). */
export type CatalogEntry = { readonly id: string; readonly name: string; readonly alt: string };

export type AiWord = Pick<TranscriptWord, "w" | "startMs" | "endMs" | "filler"> & {
  /** The transcriber's confidence, 0 to 1; a word under `UNCLEAR_BELOW` is marked `u`. */
  readonly conf?: number;
};

/** Below this confidence the transcriber was unsure it heard the word (B2-T50). */
export const UNCLEAR_BELOW = 0.6;
