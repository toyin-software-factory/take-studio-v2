import { type BackgroundComposite, compositeFilters } from "./keying";
import type { HdrTransfer } from "./probe";

/**
 * Rules only trimming and the render graph (spec 0004, Flow steps 5 and 6; AC-5, AC-6).
 * Pure: no process, no I/O. Times are milliseconds of the original upload unless named.
 */

/** Trim settings (spec 0004 AC-5). One place to tune them with Toyin. */
export const TRIM = {
  /** silencedetect noise floor. */
  noiseDb: -35,
  /** Shortest silence that becomes a cut. */
  minSilenceMs: 700,
  /** Silence kept on each side of a cut in the middle of the take. */
  marginMs: 250,
  /** Silence kept next to speech when the silence touches the start or end. */
  edgeMarginMs: 100,
  /** Cuts closer than this are merged. */
  mergeGapMs: 100,
  /** Most keep segments one render graph may have. */
  maxSegments: 500,
} as const;

export type Silence = { readonly startMs: number; readonly endMs: number };
export type PauseCut = Silence & {
  readonly kind: "pause";
  readonly proposedBy: "rules";
  readonly reason: string;
};
export type Range = { readonly startMs: number; readonly endMs: number };

/** `silencedetect` filter argument from the settings. */
export function silencedetectFilter(): string {
  return `silencedetect=noise=${TRIM.noiseDb}dB:d=${TRIM.minSilenceMs / 1000}`;
}

/**
 * Silences from ffmpeg's stderr: `silence_start: s` then `silence_end: s | …`. Start is floored
 * and end ceiled to whole ms, both clamped to the take; a silence still open at the end of the
 * stream ends at `durationMs`.
 */
export function parseSilences(stderr: string, durationMs: number): Silence[] {
  const silences: Silence[] = [];
  let openStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (start?.[1] !== undefined) {
      openStart = Math.max(0, Math.floor(Number(start[1]) * 1000));
    } else if (end?.[1] !== undefined && openStart !== null) {
      silences.push({
        startMs: openStart,
        endMs: Math.min(durationMs, Math.ceil(Number(end[1]) * 1000)),
      });
      openStart = null;
    }
  }
  if (openStart !== null && openStart < durationMs)
    silences.push({ startMs: openStart, endMs: durationMs });
  return silences.filter((s) => s.endMs > s.startMs);
}

/** "Pause of 1.4 s" from the silence length. */
function reasonFor(silence: Silence): string {
  return `Pause of ${((silence.endMs - silence.startMs) / 1000).toFixed(1)} s`;
}

/**
 * Cuts from silences (AC-5): each silence of at least 700 ms becomes a pause cut keeping 250 ms
 * on each side; a silence touching the start or end keeps only 100 ms next to the speech; cuts
 * closer than 100 ms apart are merged (keeping the first reason).
 */
export function cutsFromSilences(silences: readonly Silence[], durationMs: number): PauseCut[] {
  const cuts: PauseCut[] = [];
  for (const silence of [...silences].sort((a, b) => a.startMs - b.startMs)) {
    if (silence.endMs - silence.startMs < TRIM.minSilenceMs) continue;
    const atStart = silence.startMs <= 0;
    const atEnd = silence.endMs >= durationMs;
    let startMs: number;
    let endMs: number;
    if (atStart && atEnd) continue; // the whole take is silence: nothing to keep around
    if (atStart) {
      startMs = 0;
      endMs = silence.endMs - TRIM.edgeMarginMs;
    } else if (atEnd) {
      startMs = silence.startMs + TRIM.edgeMarginMs;
      endMs = durationMs;
    } else {
      startMs = silence.startMs + TRIM.marginMs;
      endMs = silence.endMs - TRIM.marginMs;
    }
    if (endMs <= startMs) continue;

    const previous = cuts.at(-1);
    if (previous && startMs - previous.endMs < TRIM.mergeGapMs) {
      cuts[cuts.length - 1] = { ...previous, endMs: Math.max(previous.endMs, endMs) };
    } else {
      cuts.push({ startMs, endMs, kind: "pause", proposedBy: "rules", reason: reasonFor(silence) });
    }
  }
  return cuts;
}

/**
 * The ranges to keep given the removed ranges (sorted, non overlapping, within the take). If
 * there would be more than `maxSegments` keep ranges, the shortest removed ranges are dropped
 * (their pauses stay in) until it fits.
 */
export function keepRanges(
  removed: readonly Range[],
  durationMs: number,
  maxSegments: number = TRIM.maxSegments,
): Range[] {
  let cuts = [...removed].sort((a, b) => a.startMs - b.startMs);
  if (cuts.length + 1 > maxSegments) {
    const keepCount = maxSegments - 1;
    const longest = new Set(
      [...cuts].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs)).slice(0, keepCount),
    );
    cuts = cuts.filter((c) => longest.has(c));
  }
  const keep: Range[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.startMs > cursor) keep.push({ startMs: cursor, endMs: cut.startMs });
    cursor = Math.max(cursor, cut.endMs);
  }
  if (cursor < durationMs) keep.push({ startMs: cursor, endMs: durationMs });
  return keep;
}

/**
 * Snaps keep ranges to the source's frame grid (spec 0004 AC-6). `trim` can only start a video
 * segment on a frame, while `atrim` cuts audio anywhere, so an unaligned cut point leaves the
 * audio up to one frame late after every cut. Aligning both to the same frame boundary removes
 * that offset. Ranges that collapse to nothing are dropped. Times stay in (fractional) ms.
 */
export function alignToFrames(keep: readonly Range[], fps: number | null): Range[] {
  const frameMs = 1000 / (fps && fps > 0 ? fps : 30);
  const snap = (ms: number) => Math.round(ms / frameMs) * frameMs;
  return keep
    .map((r) => ({ startMs: snap(r.startMs), endMs: snap(r.endMs) }))
    .filter((r) => r.endMs > r.startMs);
}

/** Total length of ranges in ms. */
export function totalMs(ranges: readonly Range[]): number {
  return ranges.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
}

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
} as const;

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
  const crop = options.size ? zoomCrop(options.size.width, options.size.height) : null;
  const lastIndex = keep.length - 1;
  const fades = (r: Range, i: number): string => {
    const len = r.endMs - r.startMs;
    const fadeMs = Math.min(SMOOTH.audioFadeMs, len / 2);
    const cutAtStart = !(i === 0 && r.startMs <= 0);
    const cutAtEnd = !(i === lastIndex && options.durationMs !== undefined
      ? r.endMs >= options.durationMs
      : i === lastIndex && options.durationMs === undefined);
    return [
      cutAtStart ? `,afade=t=in:st=0:d=${seconds(fadeMs)}` : "",
      cutAtEnd ? `,afade=t=out:st=${seconds(len - fadeMs)}:d=${seconds(fadeMs)}` : "",
    ].join("");
  };
  const lines = keep.flatMap((r, i) => [
    `[0:v]trim=start=${videoSeconds(r.startMs)}:end=${videoSeconds(r.endMs)},setpts=PTS-STARTPTS${
      zooms?.[i] && crop && options.size
        ? `,crop=${crop.w}:${crop.h},scale=${options.size.width}:${options.size.height},setsar=1`
        : ""
    }[v${i}];`,
    ...(hasAudio
      ? [
          `[0:a]atrim=start=${seconds(r.startMs)}:end=${seconds(r.endMs)},asetpts=PTS-STARTPTS${
            keep.length > 1 ? fades(r, i) : ""
          }[a${i}];`,
        ]
      : []),
  ]);
  const inputs = keep.map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
  lines.push(
    `${inputs}concat=n=${keep.length}:v=1:a=${hasAudio ? 1 : 0}[vc]${hasAudio ? "[aout]" : ""};`,
  );
  const color = hdr ? toneMapFilter(hdr) : "format=yuv420p";
  if (background) {
    lines.push(`[vc]${color}[base];`, ...compositeFilters(background));
  } else {
    lines.push(`[vc]${color}[vout]`);
  }
  return lines.join("\n");
}

/** The output frame rate argument: the source's average, rounded to 3 decimals (CFR). */
export function outputFps(fps: number | null): string {
  return String(Math.round((fps ?? 30) * 1000) / 1000);
}

/** `out_time_us` (or `out_time_ms`, which is also µs) from an ffmpeg `-progress` chunk, in ms. */
export function progressOutTimeMs(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  const last = matches.at(-1)?.[1];
  return last === undefined ? null : Math.floor(Number(last) / 1000);
}

/**
 * A progress reporter that writes at most every `minIntervalMs` and only when the value moved
 * by at least `minDelta` points (spec 0004 Flow step 6). `flush` writes the last value.
 */
export function throttledProgress(
  write: (percent: number) => Promise<unknown>,
  options: {
    readonly minIntervalMs?: number;
    readonly minDelta?: number;
    readonly now?: () => number;
  } = {},
) {
  const minIntervalMs = options.minIntervalMs ?? 2_000;
  const minDelta = options.minDelta ?? 1;
  const now = options.now ?? Date.now;
  let lastWritten = -1;
  let lastAt = -Infinity;
  let pending: number | null = null;
  // Progress is best effort: a failed write must never fail the job or leave a rejection
  // behind. Writes run one after another, so an older value can never overwrite a newer one,
  // and `flush` waits for every write still in flight.
  let chain: Promise<void> = Promise.resolve();
  const safeWrite = (percent: number): Promise<void> => {
    chain = chain.then(async () => {
      try {
        await write(percent);
      } catch {
        // The next report or the final step write will carry the state.
      }
    });
    return chain;
  };
  return {
    async report(percent: number): Promise<void> {
      const value = Math.max(0, Math.min(100, Math.floor(percent)));
      pending = value;
      if (value - lastWritten < minDelta || now() - lastAt < minIntervalMs) return;
      lastWritten = value;
      lastAt = now();
      pending = null;
      await safeWrite(value);
    },
    async flush(): Promise<void> {
      if (pending !== null && pending !== lastWritten) {
        lastWritten = pending;
        pending = null;
        await safeWrite(lastWritten);
      }
      await chain;
    },
  };
}
