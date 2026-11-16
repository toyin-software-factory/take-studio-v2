/**
 * Where the credit goes and the ffmpeg text that draws it (spec 0026 AC-1, AC-2). Pure. The
 * credit is one committed PNG (white text on a 60% black box), overlaid by the same ffmpeg pass
 * that renders, so it is in the file and every download carries it.
 */

/** The committed PNG, relative to the repo root (`scripts/render-credit-png.ts` makes it). */
export const CREDIT_PNG_PATH = "assets/credit/edited-with-take-studio.png";
/** Its own width in pixels: it is never scaled up past this. */
export const CREDIT_PNG_WIDTH = 1000;

const WIDTH_SHARE = 0.4;
const MIN_WIDTH = 160;
const MAX_WIDTH_SHARE = 0.9;
const INSET_X = 0.05;
const INSET_Y = 0.05;
/** Portrait clears Instagram Reels' safe zone (14% top, 6% sides, Meta Ads Guide), spec 0026 5a. */
const INSET_X_PORTRAIT = 0.06;
const INSET_Y_PORTRAIT = 0.14;
/** Shown for the last 4 seconds, or the last half for a video under 8 seconds. */
const SHOW_SECONDS = 4;

export type CreditPlacement = {
  readonly width: number;
  readonly x: number;
  readonly y: number;
  /** Output second at which the credit appears. */
  readonly startSeconds: number;
};

/**
 * Width is 40% of the shorter side, at least 160 px, at most 90% of the video width (the cap
 * wins over the minimum) and never past the PNG's own width. The inset is 5% of the width from
 * the left and 5% of the height from the top (6% and 14% for a portrait video, which social apps
 * cover with their own controls). `durationSeconds` is the output's length.
 */
export function creditPlacement(input: {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
}): CreditPlacement {
  const { width, height, durationSeconds } = input;
  const wanted = Math.max(MIN_WIDTH, Math.round(Math.min(width, height) * WIDTH_SHARE));
  const capped = Math.min(wanted, Math.floor(width * MAX_WIDTH_SHARE), CREDIT_PNG_WIDTH);
  const portrait = height > width;
  return {
    width: capped,
    x: Math.round(width * (portrait ? INSET_X_PORTRAIT : INSET_X)),
    y: Math.round(height * (portrait ? INSET_Y_PORTRAIT : INSET_Y)),
    startSeconds:
      durationSeconds >= SHOW_SECONDS * 2 ? durationSeconds - SHOW_SECONDS : durationSeconds / 2,
  };
}

const sec = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * The filter lines that put the credit over `[from]` and give `[to]`. The PNG is input
 * `inputIndex` (one frame, read with `-f image2`), scaled to the placement width, then overlaid
 * from `startSeconds`; `eof_action=repeat` holds its last frame. No fade. It is the last stage, so
 * it ends in `format=yuv420p`.
 */
export function creditOverlayFilters(
  inputIndex: number,
  from: string,
  to: string,
  placement: CreditPlacement,
): string[] {
  const { width, x, y, startSeconds } = placement;
  return [
    `[${inputIndex}:v]scale=${width}:-1[credit];`,
    `[${from}][credit]overlay=${x}:${y}:enable='gte(t,${sec(startSeconds)})':eof_action=repeat:format=auto,format=yuv420p[${to}]`,
  ];
}

/**
 * The cheap check run before a credited encode (spec 0026 AC-10): the file is a PNG, 8 bit RGBA,
 * and exactly as wide as the committed image. A shipped build that lost or damaged the file is
 * caught here, so the render goes on without the credit instead of failing.
 */
export function isUsableCreditPng(bytes: Uint8Array): boolean {
  if (bytes.length < 33) return false;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, i) => bytes[i] === value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isHeader = view.getUint32(12) === 0x49484452; // "IHDR"
  return isHeader && view.getUint32(16) === CREDIT_PNG_WIDTH && bytes[24] === 8 && bytes[25] === 6;
}
