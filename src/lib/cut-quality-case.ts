import { z } from "zod";
import { SCRIPT_MAX_CHARS } from "./processing";
import { CUT_KINDS, type CutKind } from "./cuts";

// ----- The case -----

const ms = z.number().int().min(0).max(3_600_000);

const spanFields = { startMs: ms, endMs: ms };
const orderedSpan = (s: { startMs: number; endMs: number }) => s.startMs < s.endMs;

const wordSchema = z
  .object({
    w: z.string().min(1).max(40),
    ...spanFields,
    filler: z.boolean(),
    /** Transcriber confidence; omit for a clearly heard word. */
    conf: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine(orderedSpan, "word must end after it starts");

const pauseSchema = z
  .object(spanFields)
  .strict()
  .refine(orderedSpan, "pause must end after it starts");

const expectedSchema = z
  .object({
    ...spanFields,
    kind: z.enum(CUT_KINDS),
    verdict: z.enum(["cut", "keep"]),
    /**
     * A `cut` span with an equal copy elsewhere (a word said twice: either copy may go, one stays).
     * The scorer uses whichever of the two the cuts covered more; a tie uses the span itself.
     */
    either: z
      .object(spanFields)
      .strict()
      .refine(orderedSpan, "either must end after it starts")
      .optional(),
  })
  .strict()
  .refine(orderedSpan, "span must end after it starts")
  .refine((s) => s.either === undefined || s.verdict === "cut", "only a cut span has an either");

export const cutCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    /** Why the case exists, in plain words about the pattern. Never real speech. */
    note: z.string().min(1).max(300),
    durationMs: z.number().int().positive().max(3_600_000),
    /** Spec 0021: the invented script of a take read from one. Omitted for a take with none. */
    script: z.string().trim().min(1).max(SCRIPT_MAX_CHARS).optional(),
    words: z.array(wordSchema).min(1),
    pauses: z.array(pauseSchema),
    expected: z.array(expectedSchema),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    c.words.forEach((word, i) => {
      const prev = c.words[i - 1];
      if (prev && word.startMs < prev.endMs) fail(`word ${i} overlaps the word before it`);
      if (word.endMs > c.durationMs) fail(`word ${i} ends after the take`);
    });
    c.pauses.forEach((pause, i) => {
      const prev = c.pauses[i - 1];
      if (prev && pause.startMs < prev.endMs) fail(`pause ${i} overlaps the pause before it`);
      if (pause.endMs > c.durationMs) fail(`pause ${i} ends after the take`);
    });
    const sorted = c.expected
      .flatMap((e) => (e.either ? [e, { ...e, ...e.either, either: undefined }] : [e]))
      .sort((a, b) => a.startMs - b.startMs);
    sorted.forEach((span, i) => {
      const prev = sorted[i - 1];
      if (prev && span.startMs < prev.endMs) fail("expected spans must not overlap");
      if (span.endMs > c.durationMs) fail("an expected span ends after the take");
    });
  });
export type CutCase = z.infer<typeof cutCaseSchema>;
export type ExpectedSpan = CutCase["expected"][number];

/** A cut as scored: the applied cuts the pipeline produced. */
export type ScoredCut = {
  readonly startMs: number;
  readonly endMs: number;
  readonly kind: CutKind;
};
