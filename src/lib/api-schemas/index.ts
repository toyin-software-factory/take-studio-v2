import type { z } from "zod";
import * as requests from "./requests";
import { RESPONSE_SCHEMAS } from "./responses";

/**
 * Every schema the registry can name (spec 0018 step 6): request bodies and queries first, then
 * the success bodies. `apiSchema` is the lookup `buildOpenApi` and the docs page use.
 */
export const API_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  UploadCreateRequest: requests.uploadCreateSchema,
  UploadPartsRequest: requests.uploadPartsSchema,
  UploadCompleteRequest: requests.uploadCompleteSchema,
  TakeListQuery: requests.takeListQuerySchema,
  TakeRenameRequest: requests.takeRenameSchema,
  TranscriptFileQuery: requests.transcriptFileQuerySchema,
  TranscriptUndoRequest: requests.transcriptUndoSchema,
  ChangesRequest: requests.changesSchema,
  BackgroundChangeRequest: requests.backgroundChangeSchema,
  BackgroundPreviewRequest: requests.backgroundPreviewSchema,
  MissedRequest: requests.missedSchema,
  BackgroundUploadRequest: requests.backgroundUploadSchema,
  EmailPrefsRequest: requests.emailPrefsSchema,
  ...RESPONSE_SCHEMAS,
};

export function apiSchema(name: string): z.ZodType | undefined {
  return API_SCHEMAS[name];
}
