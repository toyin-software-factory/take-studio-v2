import { handleListBackgrounds } from "../backgrounds/library-http";
import { handleChangeBackground } from "../backgrounds/http";
import { handleGetPreview, handlePostPreview } from "../backgrounds/preview-http";
import type { PreviewHttpDeps } from "../backgrounds/preview-http";
import type { LibraryHttpDeps } from "../backgrounds/library-http";
import { handleChanges, handleJobStatus, handleWaveform } from "../changes/http";
import { handleMedia } from "../media";
import { handleDelete, handleGet, handleList, handleRename, handleRetry } from "../takes/http";
import type { TakeHttpDeps } from "../takes/http";
import { handleMissed } from "../takes/missed";
import {
  handleGetTranscript,
  handleMakeTranscript,
  handlePatchEdit,
  handleTranscriptDownload,
} from "../transcripts/http";
import type { TranscriptHttpDeps } from "../transcripts/http";
import { handleAbort, handleComplete, handleCreate, handleParts } from "../uploads/http";
import type { HttpDeps as UploadHttpDeps } from "../uploads/http";
import { handleUsage } from "../usage/http";
import type { UsageHttpDeps } from "../usage/http";
import type { MediaHttpDeps } from "../media";
import type { McpHandlers } from "./dispatch";

/**
 * Every route a tool stands for, as the route's own exported handler (spec 0019 AC-3). The table
 * is keyed by `routeKey`; `tools.test.ts` fails when a flagged registry route is missing here or a
 * key here is not flagged. The dependencies are a parameter so the real Worker (`deps.ts`) passes
 * the real factories and the tests pass their own database.
 */
export type McpRouteDeps = {
  readonly usage: () => UsageHttpDeps;
  readonly take: () => TakeHttpDeps;
  readonly media: () => MediaHttpDeps;
  readonly transcript: () => TranscriptHttpDeps;
  readonly upload: () => UploadHttpDeps;
  readonly library: () => LibraryHttpDeps;
  readonly preview: () => PreviewHttpDeps;
};

export function buildHandlers(d: McpRouteDeps): McpHandlers {
  return {
    "GET /api/usage": (r) => handleUsage(r, d.usage()),
    "GET /api/takes": (r) => handleList(r, d.take()),
    "GET /api/takes/{id}": (r, p) => handleGet(r, p.id ?? "", d.take()),
    "PATCH /api/takes/{id}": (r, p) => handleRename(r, p.id ?? "", d.take()),
    "DELETE /api/takes/{id}": (r, p) => handleDelete(r, p.id ?? "", d.take()),
    "POST /api/uploads": (r) => handleCreate(r, d.upload()),
    "POST /api/uploads/{takeId}/parts": (r, p) => handleParts(r, p.takeId ?? "", d.upload()),
    "POST /api/uploads/{takeId}/complete": (r, p) => handleComplete(r, p.takeId ?? "", d.upload()),
    "DELETE /api/uploads/{takeId}": (r, p) => handleAbort(r, p.takeId ?? "", d.upload()),
    "POST /api/takes/{id}/retry": (r, p) => handleRetry(r, p.id ?? "", d.take()),
    "GET /api/takes/{id}/jobs/{jobId}": (r, p) =>
      handleJobStatus(r, p.id ?? "", p.jobId ?? "", d.take()),
    "GET /api/takes/{id}/media": (r, p) => handleMedia(r, p.id ?? "", d.media()),
    "GET /api/takes/{id}/transcript": (r, p) => handleGetTranscript(r, p.id ?? "", d.transcript()),
    "POST /api/takes/{id}/transcript": (r, p) =>
      handleMakeTranscript(r, p.id ?? "", d.transcript()),
    "GET /api/takes/{id}/transcript/{format}": (r, p) =>
      handleTranscriptDownload(r, p.id ?? "", p.format ?? "", d.transcript()),
    "PATCH /api/takes/{id}/transcript/edits/{index}": (r, p) =>
      handlePatchEdit(r, p.id ?? "", p.index ?? "", d.transcript()),
    "GET /api/backgrounds": (r) => handleListBackgrounds(r, d.library()),
    "PUT /api/takes/{id}/background": (r, p) => handleChangeBackground(r, p.id ?? "", d.take()),
    "POST /api/takes/{id}/background/preview": (r, p) =>
      handlePostPreview(r, p.id ?? "", d.preview()),
    "GET /api/takes/{id}/background/preview": (r, p) =>
      handleGetPreview(r, p.id ?? "", d.preview()),
    "POST /api/takes/{id}/changes": (r, p) => handleChanges(r, p.id ?? "", d.take()),
    "GET /api/takes/{id}/waveform": (r, p) => handleWaveform(r, p.id ?? "", d.take()),
    "POST /api/takes/{id}/missed": (r, p) => handleMissed(r, p.id ?? "", d.take()),
  };
}
