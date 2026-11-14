import { z } from "zod";
import type { Probe } from "./take-rules";

/**
 * Reading ffprobe's JSON (spec 0004, Flow step 4; AC-4, AC-6). Pure: no process, no I/O.
 * Run ffprobe with `-v error -print_format json -show_format -show_streams`.
 */

/** HDR transfer, named the way zscale's `tin` expects it. */
export type HdrTransfer = "smpte2084" | "arib-std-b67";

export type ProbeFacts = Probe & {
  readonly hasAudio: boolean;
  /** Average frame rate (frames per second), or null when ffprobe can't tell. */
  readonly fps: number | null;
  /** PQ (`smpte2084`) or HLG (`arib-std-b67`) when the video is HDR, else null. */
  readonly hdrTransfer: HdrTransfer | null;
};

const streamSchema = z
  .object({
    codec_type: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.string().optional(),
    avg_frame_rate: z.string().optional(),
    r_frame_rate: z.string().optional(),
    color_transfer: z.string().optional(),
    disposition: z.object({ attached_pic: z.number().optional() }).partial().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    side_data_list: z.array(z.object({ rotation: z.number().optional() }).partial()).optional(),
  })
  .partial();

const ffprobeSchema = z.object({
  streams: z.array(streamSchema).default([]),
  format: z
    .object({
      format_name: z.string().optional(),
      duration: z.string().optional(),
      tags: z.record(z.string(), z.string()).optional(),
    })
    .partial()
    .default({}),
});

/** "30000/1001" → 29.97; "0/0" or junk → null. */
export function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (num === undefined || !Number.isFinite(num) || num <= 0) return null;
  const value = den === undefined ? num : den > 0 ? num / den : NaN;
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : null;
}

/** Display rotation in degrees from the side data or the legacy `rotate` tag. */
function rotationOf(stream: z.infer<typeof streamSchema>): number {
  const fromSideData = stream.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation;
  const raw = fromSideData ?? Number(stream.tags?.rotate ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Facts from ffprobe's JSON output, or null when there is no usable video stream (the take
 * then fails as corrupt). Width and height are as displayed (rotation applied).
 */
export function parseFfprobe(
  json: unknown,
  options: { readonly packetEndSeconds?: number | null } = {},
): ProbeFacts | null {
  const parsed = ffprobeSchema.safeParse(json);
  if (!parsed.success) return null;
  const { streams, format } = parsed.data;

  const video = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  if (!video?.width || !video.height) return null;

  const formatName = format.format_name ?? "";
  const isWebm = isWebmFormat(formatName);
  // A browser WebM often has no duration header, so its length is the last packet's end time.
  const fromHeader = Number(format.duration ?? video.duration);
  const seconds = isWebm ? (options.packetEndSeconds ?? fromHeader) : fromHeader;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const quarterTurn = Math.abs(rotationOf(video)) % 180 === 90;
  const isQuickTime = (format.tags?.major_brand ?? "").trim() === "qt";
  const container = formatName.split(",").includes("mov")
    ? isQuickTime
      ? "mov"
      : "mp4"
    : isWebm
      ? "webm"
      : formatName;

  const transfer = video.color_transfer;
  return {
    durationMs: Math.round(seconds * 1000),
    width: quarterTurn ? video.height : video.width,
    height: quarterTurn ? video.width : video.height,
    container,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    fps: parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate),
    hdrTransfer: transfer === "smpte2084" || transfer === "arib-std-b67" ? transfer : null,
  };
}

/** ffprobe's `format_name` for WebM and Matroska files (one demuxer, `matroska,webm`). */
export function isWebmFormat(formatName: string): boolean {
  return formatName.split(",").some((n) => n === "matroska" || n === "webm");
}

/** True when this ffprobe output is a WebM, whose length has to come from its packets. */
export function needsPacketEnd(json: unknown): boolean {
  const parsed = ffprobeSchema.safeParse(json);
  return parsed.success && isWebmFormat(parsed.data.format.format_name ?? "");
}

/**
 * The playable length in seconds from `ffprobe -select_streams v:0 -show_entries
 * packet=pts_time,duration_time -of csv=p=0`: the largest `pts_time + duration_time` minus the
 * smallest `pts_time` (the duration may be missing, then just the time), so a file whose first
 * packet starts late is not counted as longer. Null when the span is not positive.
 */
export function parsePacketEnd(csv: string): number | null {
  let end: number | null = null;
  let start: number | null = null;
  for (const line of csv.split("\n")) {
    const [time, duration] = line.trim().split(",");
    const pts = Number(time);
    if (time === undefined || time === "" || time === "N/A" || !Number.isFinite(pts) || pts < 0)
      continue;
    const length = Number(duration);
    const to = pts + (Number.isFinite(length) && length > 0 ? length : 0);
    if (start === null || pts < start) start = pts;
    if (end === null || to > end) end = to;
  }
  return end !== null && start !== null && end > start ? end - start : null;
}

/** The seek point for a thumbnail: 1 s in, or the start for clips of 2 s or less. */
export function thumbnailSeconds(durationMs: number): number {
  return durationMs > 2_000 ? 1 : 0;
}
