import { z } from "zod";

/**
 * B2-T108: the browser's response schemas exactly as they were written with full zod, before
 * they moved to `zod/mini`. Only `client-schemas.test.ts` imports this file, to prove the new
 * schemas accept and refuse the same values and produce the same parsed data. Never import it
 * from app code (full zod would come back into the first load), and never edit a schema here
 * to make a test pass: change the new schema, or decide the difference on purpose.
 */

const takeCardSchema = z.object({
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

const takeSchema = takeCardSchema.extend({
  container: z.string(),
  script: z.string().nullable().optional(),
});

const stepSchema = z.object({
  name: z.string(),
  status: z.string(),
  progress: z.number().nullable(),
});

const transcriptEditSchema = z.object({
  index: z.number(),
  old: z.string(),
  new: z.string(),
  reason: z.string(),
  undone: z.boolean(),
});

const backgroundItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  alt: z.string(),
  status: z.string(),
  failureCode: z.string().nullable().default(null),
  thumbUrl: z.string().nullable(),
});

const connectedAppSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  connectedAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

export const ORACLE = {
  takeCard: takeCardSchema,
  takeList: z.object({
    takes: z.array(takeCardSchema),
    nextCursor: z.string().nullable(),
  }),
  take: takeSchema,
  takeDetail: z.object({
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
        removedRanges: z.array(z.object({ startMs: z.number(), endMs: z.number() })).default([]),
      })
      .nullable(),
    cuts: z
      .array(
        z.object({
          id: z.string(),
          startMs: z.number(),
          endMs: z.number(),
          kind: z.string(),
          applied: z.boolean(),
          proposedBy: z.string().default("rules"),
          reason: z.string().nullable().default(null),
        }),
      )
      .default([]),
    aiEdit: z.enum(["done", "unavailable"]).nullable().default(null),
    suggestion: z
      .object({ backgroundId: z.string(), name: z.string(), reason: z.string() })
      .nullable()
      .default(null),
    originalAvailable: z.boolean().default(true),
    removedMs: z.number(),
    note: z.enum(["no_audio", "no_cuts"]).nullable(),
    background: z
      .object({ id: z.string().nullable(), name: z.string(), keyed: z.boolean() })
      .nullable()
      .default(null),
    noGreenScreen: z.boolean().default(false),
    credit: z
      .object({
        applied: z.boolean(),
        canChange: z.boolean().default(false),
        choice: z.enum(["on", "off"]).nullable().default(null),
      })
      .default({ applied: false, canChange: false, choice: null }),
    sourceFps: z.number().nullable().default(null),
    backgroundJob: z
      .object({
        status: z.string(),
        failureCode: z.string().nullable(),
        targetBackgroundId: z.string().nullable().default(null),
      })
      .nullable()
      .default(null),
  }),
  mediaLink: z.object({ url: z.string().url() }),
  apiError: z.object({ error: z.string(), message: z.string() }),
  transcriptEdit: transcriptEditSchema,
  transcriptView: z.object({
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
  }),
  backgroundItem: backgroundItemSchema,
  backgroundList: z.object({
    builtIn: z.array(backgroundItemSchema),
    mine: z.array(backgroundItemSchema),
    defaultId: z.string().nullable(),
  }),
  previewView: z.object({
    state: z.enum(["making", "ready", "failed"]),
    url: z.string().optional(),
    noGreenScreen: z.boolean().default(false),
  }),
  consentAnswer: z.object({ url: z.string().min(1) }),
  connectedApp: connectedAppSchema,
  connectedApps: z.object({ apps: z.array(connectedAppSchema) }),
  createdKey: z.object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    key: z.string().min(1),
    createdAt: z.string(),
  }),
  keyFailure: z.object({ error: z.string(), message: z.string() }),
  prompterSettings: z.object({
    wpm: z.number(),
    size: z.number(),
    follow: z.boolean().optional(),
    followDisclosed: z.boolean().optional(),
  }),
  realtimeResults: z.object({
    type: z.literal("Results"),
    channel: z.object({ alternatives: z.array(z.object({ transcript: z.string() })).min(1) }),
  }),
  realtimeToken: z.object({ token: z.string().min(1), expiresInSeconds: z.number().positive() }),
  realtimeStep: z.object({ step: z.enum(["no_key", "usage", "grant"]) }),
  siteUrl: z.url(),
  uploadError: z.object({ message: z.string() }),
  uploadCreated: z.object({
    takeId: z.string(),
    partSize: z.number().int().positive(),
    partCount: z.number().int().positive(),
  }),
  uploadSizeMismatch: z.object({ error: z.literal("size_mismatch") }),
  uploadLinks: z.object({
    parts: z.array(z.object({ partNumber: z.number().int(), url: z.string() })),
    expiresInSeconds: z.number().positive(),
  }),
  emailPrefs: z.object({ takeEmails: z.boolean() }),
  renamed: z.object({ take: takeSchema }),
  changeError: z.object({ error: z.string(), message: z.string().optional() }),
  changeJob: z.object({ status: z.string() }),
  changeStarted: z.object({ jobId: z.string() }),
  usageBody: z.object({
    usedSeconds: z.number(),
    allowanceSeconds: z.number(),
    remainingSeconds: z.number(),
    resetsOn: z.string(),
  }),
  waveform: z.object({ waveform: z.array(z.number()).nullable() }),
} as const;
