/**
 * Read time rules for a transcript (spec 0007, Pipeline step 3). Pure: the stored words are on
 * the original take; everything shown or exported is mapped onto the trimmed video here, with
 * the same frame aligned keep ranges the render uses, so nothing is stored twice and the
 * captions line up with the video.
 *
 * Split by job (B2-T116): `transcript-timeline-types` (the shapes and caption rules),
 * `transcript-trim` (words onto the trimmed video) and `transcript-cues` (cues, SRT, VTT, text).
 * This file only re-exports them.
 */
export {
  CAPTION_RULES,
  type Cue,
  type TrimmedParagraph,
  type TrimmedWord,
} from "./transcript-timeline-types";
export { toTrimmedTranscript, type TimelineOptions } from "./transcript-trim";
export { buildCues, toPlainText, toSrt, toVtt } from "./transcript-cues";
