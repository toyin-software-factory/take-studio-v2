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
    cfr: v.r_frame_rate === v.avg_frame_rate,
    fps: String(v.avg_frame_rate),
    hasAudio: raw.streams.some((s) => s.codec_type === "audio"),
    durationMs: Math.round(Number(raw.format.duration) * 1000),
    faststart: bytes.indexOf("moov") < bytes.indexOf("mdat"),
  };
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
