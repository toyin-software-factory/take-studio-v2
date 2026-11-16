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
const INSET_Y_PORTRAIT = 0.1;
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
 * the left and 5% of the height from the top (10% for a portrait video, which social apps cover
 * with their own controls). `durationSeconds` is the output's length.
 */
export function creditPlacement(input: {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
}): CreditPlacement {
  const { width, height, durationSeconds } = input;
  const wanted = Math.max(MIN_WIDTH, Math.round(Math.min(width, height) * WIDTH_SHARE));
  const capped = Math.min(wanted, Math.floor(width * MAX_WIDTH_SHARE), CREDIT_PNG_WIDTH);
  return {
    width: capped,
    x: Math.round(width * INSET_X),
    y: Math.round(height * (height > width ? INSET_Y_PORTRAIT : INSET_Y)),
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
