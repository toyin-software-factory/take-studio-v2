/**
 * AI editing, pure part (spec 0012): the settings, the compact request, the answer schema and
 * `validateAiEdit`. No network and no SDK here; the `ai_edit` step in `src/trigger/take-run`
 * makes the one Claude call. The request, the answer and every reason are personal data: this
 * module never logs anything.
 *
 * Split by job (B2-T116): `ai-edit-config` (settings and shared shapes), `ai-edit-answer` (the
 * answer schema), `ai-edit-request` (the prompt), `ai-edit-pieces` (the checks) and
 * `ai-edit-validate` (smoothing and `validateAiEdit`). This file only re-exports them.
 */
export {
  AI_CAUSES,
  AI_EDIT,
  UNCLEAR_BELOW,
  wordCutMaxShareFor,
  type AiCandidate,
  type AiCause,
  type AiWord,
  type CatalogEntry,
} from "./ai-edit-config";
export { AI_EDIT_JSON_SCHEMA, aiEditAnswerSchema, type AiEditAnswer } from "./ai-edit-answer";
export {
  CHARS_PER_TOKEN,
  FIXED_INPUT_TOKENS,
  buildAiRequest,
  estimateInputTokens,
  type AiRequest,
} from "./ai-edit-request";
export type { AiFix, ValidAiEdit } from "./ai-edit-pieces";
export { smoothWordCutEdges, validateAiEdit } from "./ai-edit-validate";
