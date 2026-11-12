/**
 * Inspecting a rendered file with local ffprobe/ffmpeg (spec 0004 AC-6): size, codec, colour,
 * CFR, faststart, duration, and A/V sync measured on the sync fixture (a white flash exactly at
 * every tone onset: flash frames by `signalstats`, tone onsets by `silencedetect`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isGreen } from "../../src/lib/keying";

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

/**
 * One decoded frame of a video or image, for the background checks (spec 0008): its size, the
 * share of green pixels (hue 80 to 160, saturation at least 0.30, value at least 0.25: the rule
 * detection uses) and the colour of its top left corner, where a studio shows instead of a wall.
 */
export function frameStats(path: string, atSeconds = 1) {
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_streams", "-select_streams", "v:0", path],
      { encoding: "utf8" },
    ),
  ) as { streams: { width: number; height: number }[] };
  const raw = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(atSeconds),
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      "scale=320:-2,format=rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 64 << 20 },
  ).stdout;
  // A stream without a decoded frame must fail the check, not read as a grey corner.
  if (raw.length < 3) throw new Error(`no frame decoded from ${path}`);
  let green = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) {
    if (isGreen({ r: raw[i]!, g: raw[i + 1]!, b: raw[i + 2]! })) green += 1;
  }
  return {
    width: probe.streams[0]!.width,
    height: probe.streams[0]!.height,
    greenShare: green / (raw.length / 3),
    corner: { r: raw[0]!, g: raw[1]!, b: raw[2]! },
  };
}
