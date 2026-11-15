/**
 * Rules only trimming and the render graph (spec 0004, Flow steps 5 and 6; AC-5, AC-6).
 * Pure: no process, no I/O. Times are milliseconds of the original upload unless named.
 *
 * Split by job (B2-T116): `trim-cuts` (silences to cuts and keep ranges), `trim-render` (the
 * ffmpeg filter graph) and `trim-progress` (the progress helpers). This file only re-exports.
 */
export {
  TRIM,
  alignToFrames,
  cutsFromSilences,
  keepRanges,
  parseSilences,
  silencedetectFilter,
  totalMs,
  type PauseCut,
  type Range,
  type Silence,
} from "./trim-cuts";
export {
  SMOOTH,
  endSlackMs,
  pushPlan,
  renderFilterScript,
  renderLengthSeconds,
  toneMapFilter,
  zoomPlan,
  type RenderGraphOptions,
} from "./trim-render";
export { outputFps, progressOutTimeMs, throttledProgress } from "./trim-progress";
