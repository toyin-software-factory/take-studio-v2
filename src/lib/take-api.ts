import * as z from "zod/mini";

/**
 * Shapes of the take API responses as the browser reads them (spec 0004 API surface;
 * built by `src/server/takes/views.ts`). Parsed with zod because they cross a boundary.
 * B2-T108: these are written with `zod/mini`, so the first load of the signed in pages does not
 * carry all of zod. A schema here accepts and refuses exactly what the full zod one did
 * (`client-schemas.test.ts` checks that against the old shapes in `client-schema-oracle.ts`).
 */

export const takeCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  durationMs: z.nullable(z.number()),
  videoExpiresAt: z.nullable(z.string()),
  createdAt: z.nullable(z.string()),
  failureCode: z.nullable(z.string()),
  retryable: z.boolean(),
  expired: z.boolean(),
});
export type TakeCard = z.infer<typeof takeCardSchema>;

export const takeListSchema = z.object({
  takes: z.array(takeCardSchema),
  nextCursor: z.nullable(z.string()),
});
export type TakeList = z.infer<typeof takeListSchema>;

/** The take page's take: the card plus the file type and the creator's own script (spec 0021, null or absent when none). */
export const takeSchema = z.extend(takeCardSchema, {
  container: z.string(),
  script: z.optional(z.nullable(z.string())),
});
export type TakeData = z.infer<typeof takeSchema>;

const stepSchema = z.object({
  name: z.string(),
  status: z.string(),
  progress: z.nullable(z.number()),
});

export const takeDetailSchema = z.object({
  take: takeSchema,
  latestJob: z.nullable(
    z.object({
      id: z.string(),
      kind: z.string(),
      status: z.string(),
      failureCode: z.nullable(z.string()),
      steps: z.array(stepSchema),
    }),
  ),
  latestRender: z.nullable(
    z.object({
      id: z.string(),
      status: z.string(),
      durationMs: z.nullable(z.number()),
      /** Spec 0011: the cut ranges this render was made with. */
      removedRanges: z._default(z.array(z.object({ startMs: z.number(), endMs: z.number() })), []),
    }),
  ),
  /** Spec 0011: every cut in time order; `applied` is the state of the current video. */
  cuts: z._default(
    z.array(
      z.object({
        id: z.string(),
        startMs: z.number(),
        endMs: z.number(),
        kind: z.string(),
        applied: z.boolean(),
        /** Spec 0012: `rules`, `ai` or `creator`; and the reason line (null on older cuts). */
        proposedBy: z._default(z.string(), "rules"),
        reason: z._default(z.nullable(z.string()), null),
      }),
    ),
    [],
  ),
  /** Spec 0012: how the AI edit ended; null for older takes. */
  aiEdit: z._default(z.nullable(z.enum(["done", "unavailable"])), null),
  /** Spec 0012 AC-5: the AI's suggested built in background; null when none. */
  suggestion: z._default(
    z.nullable(z.object({ backgroundId: z.string(), name: z.string(), reason: z.string() })),
    null,
  ),
  /** Spec 0011: false once the original has expired (nothing can be rendered). */
  originalAvailable: z._default(z.boolean(), true),
  removedMs: z.number(),
  note: z.nullable(z.enum(["no_audio", "no_cuts"])),
  /** Spec 0008: the background the finished video is on (green replaced), else null. */
  background: z._default(
    z.nullable(z.object({ id: z.nullable(z.string()), name: z.string(), keyed: z.boolean() })),
    null,
  ),
  noGreenScreen: z._default(z.boolean(), false),
  /** Spec 0026: whether the stored video carries the credit; older bodies say no. */
  credit: z._default(
    z.object({
      applied: z.boolean(),
      canChange: z._default(z.boolean(), false),
      choice: z._default(z.nullable(z.enum(["on", "off"])), null),
    }),
    { applied: false, canChange: false, choice: null },
  ),
  /** B2-T156: the source frame rate the render snapped its cuts to; null when unknown. */
  sourceFps: z._default(z.nullable(z.number()), null),
  backgroundJob: z._default(
    z.nullable(
      z.object({
        status: z.string(),
        failureCode: z.nullable(z.string()),
        targetBackgroundId: z._default(z.nullable(z.string()), null),
      }),
    ),
    null,
  ),
});
export type TakeDetail = z.infer<typeof takeDetailSchema>;

export const mediaLinkSchema = z.object({ url: z.url() });

export const apiErrorSchema = z.object({ error: z.string(), message: z.string() });

/** The friendly message from an API error body, or `fallback`. */
export function apiMessage(data: unknown, fallback: string): string {
  const parsed = apiErrorSchema.safeParse(data);
  return parsed.success ? parsed.data.message : fallback;
}

/** A card's fields refreshed from a take detail (polling a processing card, AC-8). */
export function cardFromDetail(detail: TakeDetail): TakeCard {
  const { take, latestRender } = detail;
  return {
    id: take.id,
    title: take.title,
    status: take.status,
    durationMs:
      latestRender?.status === "succeeded" && latestRender.durationMs !== null
        ? latestRender.durationMs
        : take.durationMs,
    videoExpiresAt: take.videoExpiresAt,
    createdAt: take.createdAt,
    failureCode: take.failureCode,
    retryable: take.retryable,
    expired: take.expired,
  };
}

/** One transcript fix (spec 0012): the word index, the old and new text, the reason, undone or not. */
export const transcriptEditSchema = z.object({
  index: z.number(),
  old: z.string(),
  new: z.string(),
  reason: z.string(),
  undone: z.boolean(),
});

/** GET /api/takes/{id}/transcript (spec 0007): state, optional skip reason, trimmed paragraphs and version. */
export const transcriptViewSchema = z.object({
  state: z.enum(["none", "making", "ready", "skipped", "failed"]),
  reason: z.optional(z.enum(["not_english", "no_speech", "original_gone"])),
  canMake: z.boolean(),
  version: z.optional(z.string()),
  paragraphs: z.optional(
    z.array(
      z.object({
        startMs: z.number(),
        words: z.array(
          z.object({
            index: z.number(),
            w: z.string(),
            startMs: z.number(),
            endMs: z.number(),
            filler: z.boolean(),
          }),
        ),
      }),
    ),
  ),
  edits: z._default(z.array(transcriptEditSchema), []),
});
export type TranscriptViewData = z.infer<typeof transcriptViewSchema>;
