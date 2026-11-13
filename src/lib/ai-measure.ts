import { z } from "zod";
import type { AiCause, CatalogEntry } from "@/lib/ai-edit";
import { studiosToInstall } from "@/lib/built-in-backgrounds";
import type { ProposedCut } from "@/lib/cut-rules";

/**
 * Pure parts of the temporary `ai-measure` task (B-T18, C-15; removed with `ai-key-check` after
 * C-15): the payload, the catalog the real run would send, and the numbers only result. The
 * result type has no string field that could carry text: counts, milliseconds and fixed words.
 */

export const AI_MEASURE_CLIPS = ["speech", "ten-min"] as const;
export type AiMeasureClip = (typeof AI_MEASURE_CLIPS)[number];

export const aiMeasurePayloadSchema = z.object({
  token: z.string().min(1),
  clip: z.enum(AI_MEASURE_CLIPS),
});

/** The built in studios as the AI request lists them: the same registry the seed installs. */
export function realCatalog(): readonly CatalogEntry[] {
  return studiosToInstall(false).map((b) => ({ id: b.id, name: b.name, alt: b.alt }));
}

/** Why a measured run did not give AI cuts (an `AiCause`, or the transcript ending without words). */
export type AiMeasureFallback = AiCause | "transcript_skipped";

export type AiMeasureResult =
  | { readonly outcome: "skipped" }
  | { readonly outcome: "no_key"; readonly missing: "deepgram" | "anthropic" }
  | {
      readonly outcome: "measured";
      readonly clip: AiMeasureClip;
      readonly clipMs: number;
      readonly words: number;
      readonly candidates: number;
      readonly transcriptMs: number;
      /** Zero when the AI step did not run (a transcript that failed or had no words). */
      readonly aiEditMs: number;
      /** From the start of the transcript step to the end of the AI edit step. */
      readonly totalMs: number;
      readonly deadlineMs: number;
      readonly withinDeadline: boolean;
      readonly catalogEntries: number;
      readonly estimatedInputTokens: number | null;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      /** All validated cuts (every one is proposed by `ai`), and how many of them are applied. */
      readonly aiCuts: number | null;
      readonly aiCutsApplied: number | null;
      /** Null when the AI edit produced a valid answer. */
      readonly fallback: AiMeasureFallback | null;
    };

/** Counts the validated cuts: all proposed by the AI, and those the run would apply. */
export function countAiCuts(cuts: readonly ProposedCut[]): {
  readonly aiCuts: number;
  readonly aiCutsApplied: number;
} {
  const ai = cuts.filter((c) => c.proposedBy === "ai");
  return { aiCuts: ai.length, aiCutsApplied: ai.filter((c) => c.applied !== false).length };
}
