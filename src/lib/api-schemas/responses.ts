import { z } from "zod";
import { CUT_KINDS, CUT_PROPOSERS } from "../cuts";
import {
  BACKGROUND_STATUSES,
  JOB_KINDS,
  JOB_STATUSES,
  PREVIEW_STATUSES,
  RENDER_STATUSES,
  STEP_STATUSES,
  TAKE_STATUSES,
} from "../processing";

/**
 * The success bodies of the public API routes (spec 0018 step 6), as the handlers send them.
 * Used by the docs page and `/api/openapi.json`; `api-schemas.test.ts` checks them against the
 * registry. Times are ISO 8601 strings, durations are milliseconds unless the name says seconds.
 */

const iso = z.iso.datetime().nullable();

const takeFields = {
  id: z.uuid(),
  title: z.string(),
  status: z.enum(TAKE_STATUSES),
  durationMs: z.number().nullable(),
  videoExpiresAt: iso,
  createdAt: iso,
  failureCode: z.string().nullable(),
  retryable: z.boolean(),
  expired: z.boolean(),
};

const takeCard = z.object(takeFields);

const take = z.object({
  ...takeFields,
  container: z.string(),
  source: z.enum(["file", "recording"]),
  script: z.string().nullable(),
});

const job = z.object({
  id: z.uuid(),
  kind: z.enum(JOB_KINDS),
  status: z.enum(JOB_STATUSES),
  failureCode: z.string().nullable(),
  steps: z.array(
    z.object({
      name: z.string(),
      status: z.enum(STEP_STATUSES),
      progress: z.number().nullable(),
    }),
  ),
});

const range = z.object({ startMs: z.number(), endMs: z.number() });

const transcriptWord = z.object({
  index: z.number().int(),
  w: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  filler: z.boolean(),
});

const transcriptEdit = z.object({
  index: z.number().int(),
  old: z.string(),
  new: z.string(),
  reason: z.string(),
  undone: z.boolean(),
});

const backgroundItem = z.object({
  id: z.uuid(),
  name: z.string(),
  alt: z.string(),
  status: z.enum(BACKGROUND_STATUSES),
  failureCode: z.string().nullable(),
  /** A short lived link to the thumbnail; null until the image has been processed. */
  thumbUrl: z.string().nullable(),
});

const preview = z.object({
  state: z.enum(PREVIEW_STATUSES),
  /** A link to the still, only when `state` is `ready`. */
  url: z.string().optional(),
  noGreenScreen: z.boolean(),
});

/** Every response schema, by the name the registry uses. */
export const RESPONSE_SCHEMAS = {
  UploadCreated: z.object({
    takeId: z.uuid(),
    partSize: z.number().int().positive(),
    partCount: z.number().int().positive(),
  }),
  UploadPartLinks: z.object({
    parts: z.array(z.object({ partNumber: z.number().int(), url: z.string() })),
    expiresInSeconds: z.number().positive(),
  }),
  UploadCompleted: z.object({ takeId: z.uuid(), status: z.enum(TAKE_STATUSES) }),
  UploadAborted: z.object({ takeId: z.uuid() }),
  TakeList: z.object({ takes: z.array(takeCard), nextCursor: z.string().nullable() }),
  TakeDetail: z.object({
    take,
    latestJob: job.nullable(),
    latestRender: z
      .object({
        id: z.uuid(),
        status: z.enum(RENDER_STATUSES),
        durationMs: z.number().nullable(),
        /** The cuts this render was made with. */
        removedRanges: z.array(range),
      })
      .nullable(),
    removedMs: z.number(),
    note: z.enum(["no_audio", "no_cuts"]).nullable(),
    background: z
      .object({ id: z.uuid().nullable(), name: z.string(), keyed: z.boolean() })
      .nullable(),
    noGreenScreen: z.boolean(),
    backgroundJob: z
      .object({
        status: z.enum(JOB_STATUSES),
        failureCode: z.string().nullable(),
        targetBackgroundId: z.uuid().nullable(),
      })
      .nullable(),
    aiEdit: z.enum(["done", "unavailable"]).nullable(),
    suggestion: z
      .object({ backgroundId: z.uuid(), name: z.string(), reason: z.string() })
      .nullable(),
    cuts: z.array(
      z.object({
        id: z.uuid(),
        startMs: z.number(),
        endMs: z.number(),
        kind: z.enum(CUT_KINDS),
        /** True when the current video has this cut. */
        applied: z.boolean(),
        proposedBy: z.enum(CUT_PROPOSERS),
        reason: z.string().nullable(),
      }),
    ),
    originalAvailable: z.boolean(),
  }),
  TakeRenamed: z.object({ take }),
  RetryStarted: z.object({ job }),
  MediaLink: z.object({ url: z.string().url() }),
  TranscriptView: z.object({
    state: z.enum(["none", "making", "ready", "skipped", "failed"]),
    reason: z.enum(["not_english", "no_speech", "original_gone"]).optional(),
    canMake: z.boolean(),
    version: z.string().optional(),
    paragraphs: z
      .array(z.object({ startMs: z.number(), words: z.array(transcriptWord) }))
      .optional(),
    edits: z.array(transcriptEdit).optional(),
  }),
  TranscriptMaking: z.object({ state: z.literal("making") }),
  /** The file itself (text, SRT or WebVTT), not JSON. */
  TranscriptFile: z.string(),
  TranscriptEditChanged: z.object({ edit: transcriptEdit, version: z.string() }),
  JobStarted: z.object({ jobId: z.uuid() }),
  JobStatus: z.object({ status: z.enum(JOB_STATUSES) }),
  Waveform: z.object({
    /** 1 to 1000 integers from 0 to 100, evenly spaced over the original; null until computed. */
    waveform: z.array(z.number().int().min(0).max(100)).nullable(),
  }),
  BackgroundPreview: preview,
  BackgroundList: z.object({
    builtIn: z.array(backgroundItem),
    mine: z.array(backgroundItem),
    /** Your last pick, or null for "keep original". */
    defaultId: z.uuid().nullable(),
  }),
  BackgroundUploadStarted: z.object({
    id: z.uuid(),
    /** A presigned link to send the image to with a PUT. */
    uploadUrl: z.string(),
  }),
  BackgroundUploadCompleted: z.object({ status: z.literal("processing") }),
  EmailPrefs: z.object({ takeEmails: z.boolean() }),
  Usage: z.object({
    usedSeconds: z.number(),
    allowanceSeconds: z.number(),
    remainingSeconds: z.number(),
    /** First day of the next UTC month, `YYYY-MM-DD`. */
    resetsOn: z.string(),
  }),
} as const;
