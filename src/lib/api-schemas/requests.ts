import { z } from "zod";
import { CONTAINERS, TAKE_SOURCES } from "../processing";
import { MEDIA_KINDS, type MediaKind } from "../take-media";
import { UPLOAD } from "../uploads";

/**
 * The request bodies and query strings of the public API routes (spec 0018 step 6). These are the
 * schemas the route handlers parse with (the handlers import them from here), so the docs can
 * never describe a shape the server does not accept. Pure: no I/O.
 */

/** POST /api/uploads */
export const uploadCreateSchema = z.object({
  fileName: z.string().min(1).max(1000),
  sizeBytes: z.number().int().positive(),
  container: z.enum(CONTAINERS),
  /** Spec 0008, AC-1: a background ID or `original`; left out means no choice was made. */
  backgroundId: z.union([z.literal("original"), z.uuid()]).optional(),
  /** Spec 0021: `file` (default) or `recording`. */
  source: z.enum(TAKE_SOURCES).optional(),
  /** Spec 0021: the creator's script. Length is checked first (`script_too_long`), then stored trimmed. */
  script: z.string().optional(),
});

/**
 * POST /api/uploads as the docs show it: the body above plus the optional length hint the handler
 * reads on its own (`hintSchema` in `src/server/uploads/http.ts`) to refuse a too long video before
 * it uploads. The handler still ignores a malformed hint, so this schema is for the docs only.
 */
export const uploadCreateDocSchema = uploadCreateSchema.extend({
  durationHintMs: z.number().positive().finite().optional(),
});

/** GET /api/takes/{id}/media: `kind` is required, and `download` records the download. */
export const mediaQuerySchema = z.object({
  kind: z.enum(MEDIA_KINDS as [MediaKind, ...MediaKind[]]),
});

/** POST /api/uploads/{takeId}/parts */
export const uploadPartsSchema = z.object({
  partNumbers: z
    .array(z.number().int().positive())
    .min(1)
    .max(UPLOAD.maxPartsPerRequest)
    .refine((list) => new Set(list).size === list.length, "duplicate part numbers"),
});

/** POST /api/uploads/{takeId}/complete */
export const uploadCompleteSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string() }))
    .min(1)
    .max(10_000),
});

/** GET /api/takes?cursor=… (query) */
export const takeListQuerySchema = z.object({ cursor: z.string().optional() });

/** PATCH /api/takes/{id} */
export const takeRenameSchema = z.object({ title: z.string() });

/** GET /api/takes/{id}/transcript/{format}?timeline=… (query) */
export const transcriptFileQuerySchema = z.object({
  timeline: z.enum(["render", "original"]).optional(),
});

/** PATCH /api/takes/{id}/transcript/edits/{index} */
export const transcriptUndoSchema = z.strictObject({ undone: z.boolean() });

/** POST /api/takes/{id}/changes */
export const changesSchema = z.object({
  baseRenderId: z.uuid().nullable(),
  background: z.object({ id: z.uuid().nullable() }).optional(),
  cuts: z
    .array(z.object({ id: z.uuid(), applied: z.boolean() }))
    .max(2000)
    .refine((cuts) => new Set(cuts.map((c) => c.id)).size === cuts.length)
    .optional(),
});

/** PUT /api/takes/{id}/background */
export const backgroundChangeSchema = z.object({
  backgroundId: z.union([z.uuid(), z.literal("original")]),
});

/** POST /api/takes/{id}/background/preview, and the query of its GET (`backgroundId`) */
export const backgroundPreviewSchema = z.object({ backgroundId: z.uuid() });

/** POST /api/takes/{id}/missed */
export const missedSchema = z.object({ atMs: z.number().int().min(0) }).strict();

/** POST /api/backgrounds */
export const backgroundUploadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
});

/** PATCH /api/account/email-prefs */
export const emailPrefsSchema = z.object({ takeEmails: z.boolean() });
