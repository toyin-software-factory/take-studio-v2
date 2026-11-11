/**
 * Inspecting a rendered file with local ffprobe/ffmpeg (spec 0004 AC-6): size, codec, colour,
 * CFR, faststart, duration, and A/V sync measured on the sync fixture (a white flash exactly at
 * every tone onset: flash frames by `signalstats`, tone onsets by `silencedetect`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type RenderFacts = {
  readonly codec: string;
  readonly pixFmt: string;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly colorTransfer: string | null;
  readonly cfr: boolean;
  readonly fps: string;
  readonly hasAudio: boolean;
  readonly durationMs: number;
  readonly faststart: boolean;
};

export function renderFacts(path: string): RenderFacts {
  const raw = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
      {
        encoding: "utf8",
      },
    ),
  ) as {
    streams: Array<
      Record<string, unknown> & { codec_type: string; side_data_list?: { rotation?: number }[] }
    >;
    format: { duration: string };
  };
  const v = raw.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error("render has no video stream");
  const bytes = readFileSync(path);
  return {
    codec: String(v.codec_name),
    pixFmt: String(v.pix_fmt),
    width: Number(v.width),
    height: Number(v.height),
    rotation: v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0,
    colorTransfer: (v.color_transfer as string | undefined) ?? null,
    cfr: evenlySpaced(path),
    fps: String(v.avg_frame_rate),
    hasAudio: raw.streams.some((s) => s.codec_type === "audio"),
    durationMs: Math.round(Number(raw.format.duration) * 1000),
    faststart: bytes.indexOf("moov") < bytes.indexOf("mdat"),
  };
}

/**
 * True when the video frames are evenly spaced: every gap between successive presentation
 * timestamps is within 1 ms (or 2 % of the median gap, whichever is larger) of the median gap.
 * `r_frame_rate` is only a guessed base rate and `avg_frame_rate` an aggregate, so equal values
 * do not prove constant frame rate; the real timestamps do.
 */
function evenlySpaced(path: string): boolean {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time",
      "-of",
      "csv=p=0",
      path,
    ],
    { encoding: "utf8", maxBuffer: 64 << 20 },
  );
  const times = out
    .split("\n")
    .map((line) => Number.parseFloat(line))
    .filter((t) => Number.isFinite(t))
    .sort((x, y) => x - y);
  if (times.length < 3) return false;
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  const median = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)]!;
  const tolerance = Math.max(0.001, median * 0.02);
  return gaps.every((gap) => Math.abs(gap - median) <= tolerance);
}

function ffmpegLog(args: string[]): string {
  return spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  }).stderr;
}

/** Flash times, tone onset times and their offsets (ms) in a render of the sync fixture. */
export function avSync(path: string) {
  const yavg = ffmpegLog([
    "-i",
    path,
    "-vf",
    "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const frames = [...yavg.matchAll(/pts_time:([\d.]+)[\s\S]*?YAVG=([\d.]+)/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );
  const flashes: number[] = [];
  let lit = false;
  for (const [t, y] of frames) {
    if (y > 100 && !lit) flashes.push(t);
    lit = y > 100;
  }
  const sil = ffmpegLog([
    "-i",
    path,
    "-vn",
    "-af",
    "silencedetect=noise=-35dB:d=0.05",
    "-f",
    "null",
    "-",
  ]);
  const onsets = [...sil.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const offsetsMs = flashes.map((f) => {
    const nearest = onsets.reduce(
      (a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a),
      Number.POSITIVE_INFINITY,
    );
    return Math.round((nearest - f) * 1000);
  });
  return { flashes, onsets, offsetsMs, maxAbsOffsetMs: Math.max(0, ...offsetsMs.map(Math.abs)) };
}
