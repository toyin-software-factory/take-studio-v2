import { type CreditPlacement, creditOverlayFilters } from "./credit-filter";
import { type BackgroundComposite, compositeFilters } from "./keying";
import type { HdrTransfer } from "./probe";
import type { Range } from "./trim-cuts";

/** zscale tone map from an HDR transfer to BT.709. zscale needs `tin` spelled out (spike). */
export function toneMapFilter(transfer: HdrTransfer): string {
  return [
    `zscale=tin=${transfer}:min=bt2020nc:pin=bt2020:t=linear:npl=100`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ].join(",");
}

/** Seconds with microsecond precision (3 decimals would round frame times past the frame). */
const seconds = (ms: number) => (ms / 1000).toFixed(6);
/**
 * Video cut points sit 1 µs before the boundary, so a frame exactly on it is kept at a segment
 * start and dropped at a segment end, like `atrim` does for audio at the boundary itself.
 */
const videoSeconds = (ms: number) => (Math.max(0, ms - 0.001) / 1000).toFixed(6);

/**
 * Smooth cuts (spec 0020): a short audio fade on each edge that touches a cut, and a gentle
 * alternating zoom between kept pieces so a cut reads as an edit, not a glitch.
 */
export const SMOOTH = {
  audioFadeMs: 30,
  wordEdgeMaxMs: 80,
  zoomScale: 1.08,
  zoomMinPieceMs: 1000,
  /** The slow push: a long piece after a cut grows by this much of its base scale. */
  pushScale: 0.04,
} as const;

/**
 * How far before the take's end the last piece may stop and still be the take's own end: the
 * uncut end snaps to the nearest frame, so it is at most half a frame early. A real trailing cut
 * of a frame or more leaves the piece ending a whole frame early, so it is not mistaken for the end.
 */
export function endSlackMs(fps: number | null | undefined): number {
  return 500 / (fps && fps > 0 ? fps : 30) + 0.001;
}

/**
 * The video filters of one kept piece (after `setpts`): a slow linear push from the base scale
 * (1.00, or the zoom) to base plus `pushScale` across the piece, centred, at the source size; or
 * the plain zoom crop; or nothing. The push applies to pieces of at least `zoomMinPieceMs` that
 * follow a cut (never the first piece), so a take with no cuts has none.
 */
function pieceMotion(
  piece: {
    readonly lenMs: number;
    readonly index: number;
    readonly zoomed: boolean;
    /** The piece before it ended pushed in (only used by a short piece). */
    readonly holdsPush: boolean;
  },
  size: { readonly width: number; readonly height: number } | undefined,
  crop: { w: number; h: number } | null,
): string {
  if (!size || !crop) return "";
  const base = piece.zoomed ? SMOOTH.zoomScale : 1;
  if (piece.index > 0 && piece.lenMs >= SMOOTH.zoomMinPieceMs) {
    const factor = `(${base}+${SMOOTH.pushScale}*t/${(piece.lenMs / 1000).toFixed(6)})`;
    const even = (n: number) => `ceil(${n}*${factor}/2)*2`;
    // crop reads in_w and in_h once, at configuration, so its default centring would use the
    // first frame's size; x and y are evaluated per frame, so spell the centre out from the
    // same scaled size.
    const centre = (n: number) => `(${even(n)}-${n})/2`;
    return `,scale=w='${even(size.width)}':h='${even(size.height)}':eval=frame,crop=${size.width}:${size.height}:x='${centre(size.width)}':y='${centre(size.height)}',setsar=1`;
  }
  if (piece.index > 0 && piece.holdsPush) {
    // A short piece after a pushed one holds that piece's final scale for its whole length.
    const scale = base + SMOOTH.pushScale;
    const even = (n: number) => Math.ceil((n * scale) / 2) * 2;
    const w = even(size.width);
    const h = even(size.height);
    return `,scale=${w}:${h},crop=${size.width}:${size.height}:x=${(w - size.width) / 2}:y=${(h - size.height) / 2},setsar=1`;
  }
  return piece.zoomed
    ? `,crop=${crop.w}:${crop.h},scale=${size.width}:${size.height},setsar=1`
    : "";
}

/**
 * Per keep range, whether it is zoomed in: the first piece is not, then each piece of at least
 * `zoomMinPieceMs` flips it, and a shorter piece keeps the previous piece's zoom.
 */
export function zoomPlan(keep: readonly Range[]): boolean[] {
  let zoomed = false;
  return keep.map((r, i) => {
    if (i > 0 && r.endMs - r.startMs >= SMOOTH.zoomMinPieceMs) zoomed = !zoomed;
    return zoomed;
  });
}

/**
 * Per keep range, whether it ends pushed in (at base plus `pushScale`): a piece of at least
 * `zoomMinPieceMs` after the first pushes, and a shorter piece holds the scale the piece before
 * it ended at, so the picture never jumps back (spec 0020 AC-5).
 */
export function pushPlan(keep: readonly Range[]): boolean[] {
  let pushed = false;
  return keep.map((r, i) => {
    if (i > 0 && r.endMs - r.startMs >= SMOOTH.zoomMinPieceMs) pushed = true;
    return pushed && i > 0;
  });
}

/** Even pixel size of the centre crop for a zoom, so yuv420p stays valid. */
function zoomCrop(width: number, height: number): { w: number; h: number } {
  const even = (n: number) => Math.max(2, Math.floor(n / SMOOTH.zoomScale / 2) * 2);
  return { w: even(width), h: even(height) };
}

export type RenderGraphOptions = {
  /** The source's HDR transfer (tone mapped to SDR), or null for SDR. */
  readonly hdr: HdrTransfer | null;
  /** False for a take with no audio stream: the graph then has no audio branch. Default true. */
  readonly hasAudio?: boolean;
  /**
   * Put the keyed take on a background (spec 0008). The graph then reads the background image
   * as input 1 (`-loop 1 -framerate {fps} -i image`).
   */
  readonly background?: BackgroundComposite;
  /** The source's size. With it, and more than one piece, the pieces alternate a zoom. */
  readonly size?: { readonly width: number; readonly height: number };
  /** The take's length. A last piece ending at or past it has no cut at its end (no fade). */
  readonly durationMs?: number;
  /** The source's frame rate (for the half frame end slack); unknown counts as 30. */
  readonly fps?: number | null;
  /**
   * Spec 0026: put the credit PNG over the last seconds. It is the last input (index 1, or 2 with
   * a background) and the last stage, so `[vout]` is the credited picture.
   */
  readonly credit?: CreditPlacement;
};

/**
 * The `-filter_complex_script` for a render (AC-6): per keep range a `trim` and an `atrim` with
 * reset timestamps, one `concat`, then the colour step (tone map for HDR, else yuv420p) and,
 * with a background, the chroma key and overlay (`compositeFilters`). Outputs `[vout]` and,
 * when the take has audio, `[aout]`. Video and audio are cut at the same times, so they stay
 * in sync.
 */
export function renderFilterScript(keep: readonly Range[], options: RenderGraphOptions): string {
  const { hdr, background } = options;
  const hasAudio = options.hasAudio ?? true;
  const zooms = options.size && keep.length > 1 ? zoomPlan(keep) : null;
  const pushes = pushPlan(keep);
  const crop = options.size ? zoomCrop(options.size.width, options.size.height) : null;
  const lastIndex = keep.length - 1;
  const fades = (r: Range, i: number): string => {
    const len = r.endMs - r.startMs;
    const fadeMs = Math.min(SMOOTH.audioFadeMs, len / 2);
    const cutAtStart = !(i === 0 && r.startMs <= 0);
    const cutAtEnd = !(i === lastIndex && options.durationMs !== undefined
      ? r.endMs >= options.durationMs - endSlackMs(options.fps)
      : i === lastIndex && options.durationMs === undefined);
    return [
      cutAtStart ? `,afade=t=in:st=0:d=${seconds(fadeMs)}` : "",
      cutAtEnd ? `,afade=t=out:st=${seconds(len - fadeMs)}:d=${seconds(fadeMs)}` : "",
    ].join("");
  };
  const lines = keep.flatMap((r, i) => [
    `[0:v]trim=start=${videoSeconds(r.startMs)}:end=${videoSeconds(r.endMs)},setpts=PTS-STARTPTS${
      zooms
        ? pieceMotion(
            {
              lenMs: r.endMs - r.startMs,
              index: i,
              zoomed: zooms[i] ?? false,
              holdsPush: pushes[i] ?? false,
            },
            options.size,
            crop,
          )
        : ""
    }[v${i}];`,
    ...(hasAudio
      ? [
          `[0:a]atrim=start=${seconds(r.startMs)}:end=${seconds(r.endMs)},asetpts=PTS-STARTPTS${fades(r, i)}[a${i}];`,
        ]
      : []),
  ]);
  const inputs = keep.map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
  lines.push(
    `${inputs}concat=n=${keep.length}:v=1:a=${hasAudio ? 1 : 0}[vc]${hasAudio ? "[aout]" : ""};`,
  );
  const color = hdr ? toneMapFilter(hdr) : "format=yuv420p";
  const { credit } = options;
  const last = credit ? "vpre" : "vout";
  if (background) {
    const composite = compositeFilters(background, last);
    // The composite's last line has no `;`: it was the end of the graph. A credit follows it.
    if (credit) composite[composite.length - 1] += ";";
    lines.push(`[vc]${color}[base];`, ...composite);
  } else {
    lines.push(`[vc]${color}[${last}]${credit ? ";" : ""}`);
  }
  if (credit) lines.push(...creditOverlayFilters(background ? 2 : 1, "vpre", "vout", credit));
  return lines.join("\n");
}

/**
 * The length the render must have, in seconds for ffmpeg's `-t`: the kept ranges added up, so the
 * file is the original minus what was cut. Without it the file is as long as its longest stream:
 * a browser MP4 (Safari) has audio running about 20 ms past its video, and the last piece's audio
 * then made the render longer than the plan (B2-T96, 8065 ms against 8020).
 */
export function renderLengthSeconds(keep: readonly Range[]): string {
  return seconds(keep.reduce((sum, r) => sum + (r.endMs - r.startMs), 0));
}
