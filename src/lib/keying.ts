/**
 * Green screen detection and the chroma key filter chain (spec 0008, Rationale and Pipeline 3).
 * Pure: it works on raw RGB frames handed in by the job and builds ffmpeg filter text; running
 * ffmpeg lives in `src/trigger`. This is the one place keying is decided, so AI matting could
 * replace it later without touching the data model or the UI.
 *
 * Split by job (B2-T116): `keying-config` (settings and colour maths), `keying-detect` (the
 * green screen detection) and `keying-ffmpeg` (frame sampling and the filter chain). This file
 * only re-exports them.
 */
export {
  DETECTION,
  KEYING,
  erasesSubject,
  isKeyable,
  keyChroma,
  keySettings,
  transparentShare,
  type RawFrame,
  type Rgb,
} from "./keying-config";
export {
  detectGreenScreen,
  detectInFrame,
  fromHex,
  isGreen,
  patchMedian,
  patchRects,
  rgbToHsv,
  sampleTimesMs,
  toHex,
  type Detection,
  type NoKeyReason,
  type Patch,
} from "./keying-detect";
export {
  compositeFilters,
  frameAlphaArgs,
  frameSampleArgs,
  sampleFrameSize,
  type BackgroundComposite,
} from "./keying-ffmpeg";
