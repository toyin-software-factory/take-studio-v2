import { originalInput } from "./ffmpeg-input";
import { DETECTION, keySettings } from "./keying-config";
import { fromHex } from "./keying-detect";

export function sampleFrameSize(width: number, height: number): { width: number; height: number } {
  const w = DETECTION.frameWidth;
  const h = Math.max(2, Math.round((height * w) / width / 2) * 2);
  return { width: w, height: h };
}

/**
 * ffmpeg arguments that decode one frame of `source` at `timeMs` as raw `rgb24` bytes on stdout
 * at the sample size, after the same tone map the render uses (`toneMap` is that filter text
 * for an HDR source, null for SDR).
 */
export function frameSampleArgs(
  source: string,
  timeMs: number,
  size: { readonly width: number; readonly height: number },
  toneMap: string | null,
): string[] {
  const filters = [toneMap, `scale=${size.width}:${size.height}`, "format=rgb24"].filter(Boolean);
  return [
    "-v",
    "error",
    "-ss",
    (timeMs / 1000).toFixed(3),
    ...originalInput(source),
    "-i",
    source,
    "-frames:v",
    "1",
    "-vf",
    filters.join(","),
    "-f",
    "rawvideo",
    "-",
  ];
}

/**
 * ffmpeg arguments that decode one frame of `source` at `timeMs`, tone mapped like the render,
 * key it with the settings the render would use, and write the alpha plane as raw 8 bit gray
 * bytes (`width * height`). Counting the transparent bytes (`transparentShare`) shows what the
 * key would remove, on the real decode path, whatever the cause of a bad key.
 */
export function frameAlphaArgs(
  source: string,
  timeMs: number,
  size: { readonly width: number; readonly height: number },
  toneMap: string | null,
  keyColor: string,
): string[] {
  const { similarity, blend } = keySettings(fromHex(keyColor) ?? { r: 0, g: 177, b: 64 });
  const filters = [
    toneMap,
    `scale=${size.width}:${size.height}`,
    `format=yuva444p,chromakey=0x${keyColor.replace("#", "")}:${similarity}:${blend}`,
    "alphaextract",
    "format=gray",
  ].filter(Boolean);
  return [
    "-v",
    "error",
    "-ss",
    (timeMs / 1000).toFixed(3),
    ...originalInput(source),
    "-i",
    source,
    "-frames:v",
    "1",
    "-vf",
    filters.join(","),
    "-f",
    "rawvideo",
    "-",
  ];
}

/** What the render needs to put a keyed take on a background. */
export type BackgroundComposite = {
  /** The detected green, `#rrggbb`. */
  readonly keyColor: string;
  /** The take's display size (after rotation): the background is covered and cropped to it. */
  readonly width: number;
  readonly height: number;
};

/**
 * The filter lines that follow the colour step: key the take's video (chroma key, then green
 * spill removal), scale the background (input 1) to cover the take's frame and centre crop it,
 * and overlay. `[base]` is the concatenated, tone mapped take; the result is `[vout]` (or the
 * label `out`, when the credit overlay follows, spec 0026). The
 * keying runs on `yuva444p` so 10 bit and 4:2:0 sources key cleanly at the edges; the output
 * is `yuv420p`.
 *
 * The keyed frames start at time 0 (`setpts=PTS-STARTPTS`, S3S-T12). `overlay` pairs a frame of
 * each input by time, and the background is an image whose first frame is at 0. A preview seeks
 * into the take (`-ss`), and its first frame is then a little after 0 whenever no frame sits
 * exactly on the seek point (23.976 or 29.97 fps, an edit list): `overlay` has no keyed frame at
 * the background's time and passes the background through, so the whole person is gone.
 */
export function compositeFilters(composite: BackgroundComposite, out = "vout"): string[] {
  const { keyColor, width, height } = composite;
  const key = `0x${keyColor.replace("#", "")}`;
  const { similarity, blend } = keySettings(fromHex(keyColor) ?? { r: 0, g: 177, b: 64 });
  return [
    `[base]setpts=PTS-STARTPTS,format=yuva444p,chromakey=${key}:${similarity}:${blend},despill=type=green[fg];`,
    `[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase:out_range=tv,crop=${width}:${height},setsar=1,format=yuv420p[bg];`,
    `[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[${out}]`,
  ];
}
