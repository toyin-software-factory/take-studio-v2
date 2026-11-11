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
    .object({ id: z.string(), status: z.string(), durationMs: z.number().nullable() })
    .nullable(),
  removedMs: z.number(),
  note: z.enum(["no_audio", "no_cuts"]).nullable(),
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
          z.object({ w: z.string(), startMs: z.number(), endMs: z.number(), filler: z.boolean() }),
        ),
      }),
    )
    .optional(),
});
export type TranscriptViewData = z.infer<typeof transcriptViewSchema>;
