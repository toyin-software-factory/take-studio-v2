import { z } from "zod";
import { type TranscriptWord, isFillerWord } from "./transcript-rules";

/**
 * Deepgram pre recorded transcription (spec 0007, Pipeline step 2). Pure: the request options
 * and the zod checked response turned into our stored words. The fetch itself lives in
 * `src/trigger/transcribe-take.ts`. Nothing here logs; transcript text is personal data.
 */

export const DEEPGRAM_MODEL = "nova-3";
export const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";

/** Query options sent with every request; `mip_opt_out` keeps our audio out of model training. */
export const DEEPGRAM_OPTIONS = {
  model: DEEPGRAM_MODEL,
  detect_language: "true",
  smart_format: "true",
  punctuate: "true",
  paragraphs: "true",
  filler_words: "true",
  mip_opt_out: "true",
} as const;

export function deepgramUrl(): string {
  return `${DEEPGRAM_LISTEN_URL}?${new URLSearchParams(DEEPGRAM_OPTIONS).toString()}`;
}

const wordSchema = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
});

const alternativeSchema = z.object({
  transcript: z.string(),
  words: z.array(wordSchema).default([]),
  paragraphs: z
    .object({ paragraphs: z.array(z.object({ start: z.number() })).default([]) })
    .optional(),
});

export const deepgramResponseSchema = z.object({
  results: z.object({
    channels: z
      .array(
        z.object({
          detected_language: z.string().optional(),
          alternatives: z.array(alternativeSchema).min(1),
        }),
      )
      .min(1),
  }),
});

export type ParsedTranscript =
  | { readonly kind: "not_english" }
  | { readonly kind: "no_speech" }
  | {
      readonly kind: "words";
      readonly language: string;
      readonly text: string;
      readonly words: readonly TranscriptWord[];
    };

/** English when the detected code is `en` or starts with `en-` (en-US, en-GB, ...). */
export function isEnglish(language: string): boolean {
  return /^en($|[-_])/i.test(language);
}

const toMs = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

/**
 * Validates a Deepgram response and builds the stored words. A missing detected language
 * counts as English (the request asked for it only through `detect_language`). `para` goes on
 * the first word at or after each paragraph start; with no paragraphs block, on the first
 * word only.
 */
export function parseDeepgramResponse(
  body: unknown,
): ParsedTranscript | { readonly kind: "invalid" } {
  const parsed = deepgramResponseSchema.safeParse(body);
  if (!parsed.success) return { kind: "invalid" };
  const channel = parsed.data.results.channels[0]!;
  const language = channel.detected_language ?? "en";
  if (!isEnglish(language)) return { kind: "not_english" };

  const alt = channel.alternatives[0]!;
  if (alt.words.length === 0) return { kind: "no_speech" };

  const starts = (alt.paragraphs?.paragraphs ?? []).map((p) => toMs(p.start)).sort((a, b) => a - b);
  let next = 0;
  const words = alt.words.map((word, index): TranscriptWord => {
    const startMs = toMs(word.start);
    let para = index === 0;
    // The first word at or after each paragraph start opens that paragraph.
    while (next < starts.length && starts[next]! <= startMs) {
      para = true;
      next += 1;
    }
    const text = word.punctuated_word ?? word.word;
    return {
      w: text,
      startMs,
      endMs: Math.max(toMs(word.end), startMs),
      conf: word.confidence,
      filler: isFillerWord(text),
      para,
    };
  });
  return { kind: "words", language: "en", text: alt.transcript, words };
}
