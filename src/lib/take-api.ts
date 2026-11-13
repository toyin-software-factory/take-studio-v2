import { z } from "zod";

/**
 * Shapes of the take API responses as the browser reads them (spec 0004 API surface;
 * built by `src/server/takes/views.ts`). Parsed with zod because they cross a boundary.
 */

export const takeCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  durationMs: z.number().nullable(),
  videoExpiresAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  failureCode: z.string().nullable(),
  retryable: z.boolean(),
  expired: z.boolean(),
});
export type TakeCard = z.infer<typeof takeCardSchema>;

export const takeListSchema = z.object({
  takes: z.array(takeCardSchema),
  nextCursor: z.string().nullable(),
});
export type TakeList = z.infer<typeof takeListSchema>;

export const takeSchema = takeCardSchema.extend({ container: z.string() });
export type TakeData = z.infer<typeof takeSchema>;

const stepSchema = z.object({
  name: z.string(),
  status: z.string(),
  progress: z.number().nullable(),
});

export const takeDetailSchema = z.object({
  take: takeSchema,
  latestJob: z
    .object({
      id: z.string(),
      kind: z.string(),
      status: z.string(),
      failureCode: z.string().nullable(),
      steps: z.array(stepSchema),
    })
    .nullable(),
  latestRender: z
    .object({
      id: z.string(),
      status: z.string(),
      durationMs: z.number().nullable(),
      /** Spec 0011: the cut ranges this render was made with. */
      removedRanges: z.array(z.object({ startMs: z.number(), endMs: z.number() })).default([]),
    })
    .nullable(),
  /** Spec 0011: every cut in time order; `applied` is the state of the current video. */
  cuts: z
    .array(
      z.object({
        id: z.string(),
        startMs: z.number(),
        endMs: z.number(),
        kind: z.string(),
        applied: z.boolean(),
        /** Spec 0012: `rules`, `ai` or `creator`; and the reason line (null on older cuts). */
        proposedBy: z.string().default("rules"),
        reason: z.string().nullable().default(null),
      }),
    )
    .default([]),
  /** Spec 0012: how the AI edit ended; null for older takes. */
  aiEdit: z.enum(["done", "unavailable"]).nullable().default(null),
  /** Spec 0011: false once the original has expired (nothing can be rendered). */
  originalAvailable: z.boolean().default(true),
  removedMs: z.number(),
  note: z.enum(["no_audio", "no_cuts"]).nullable(),
  /** Spec 0008: the background the finished video is on (green replaced), else null. */
  background: z
    .object({ id: z.string().nullable(), name: z.string(), keyed: z.boolean() })
    .nullable()
    .default(null),
  noGreenScreen: z.boolean().default(false),
  backgroundJob: z
    .object({
      status: z.string(),
      failureCode: z.string().nullable(),
      targetBackgroundId: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});
export type TakeDetail = z.infer<typeof takeDetailSchema>;

export const mediaLinkSchema = z.object({ url: z.string().url() });

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
  reason: z.enum(["not_english", "no_speech", "original_gone"]).optional(),
  canMake: z.boolean(),
  version: z.string().optional(),
  paragraphs: z
    .array(
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
    )
    .optional(),
  edits: z.array(transcriptEditSchema).default([]),
});
export type TranscriptViewData = z.infer<typeof transcriptViewSchema>;
