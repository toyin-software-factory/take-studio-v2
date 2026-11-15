import { open } from "node:fs/promises";
import { z } from "zod";
import type { ImageFacts } from "@/lib/background-rules";
import { imageInput } from "@/lib/ffmpeg-input";
import { runTool } from "./media-tools";

const imageStreams = z.object({
  format: z.object({ format_name: z.string().optional() }).optional(),
  streams: z
    .array(
      z.object({
        codec_name: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        nb_read_packets: z.string().optional(),
      }),
    )
    .default([]),
});
const imageFrames = z.object({
  frames: z
    .array(
      z.object({
        side_data_list: z.array(z.object({ rotation: z.number().optional() }).loose()).optional(),
      }),
    )
    .default([]),
});

/**
 * Facts about a local image (spec 0008, Pipeline step 5): codec, size, packet count (more than
 * one means animated) and the rotation of the first frame (EXIF orientation as a display
 * matrix). The frame is decoded only when the pixel count is within `maxPixels`, so a
 * decompression bomb is never decoded here. Null when ffprobe finds no video stream.
 */
export async function probeImageFile(
  path: string,
  maxPixels: number,
  signal?: AbortSignal,
): Promise<ImageFacts | null> {
  // The demuxer comes from the first bytes; a file that is none of PNG, JPEG or WebP is not read.
  const input = await imageInputOfFile(path);
  if (!input) return null;
  const streams = imageStreams.safeParse(
    JSON.parse(
      await runTool(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-count_packets",
          "-show_entries",
          "stream=codec_name,width,height,nb_read_packets:format=format_name",
          "-of",
          "json",
          ...input,
          path,
        ],
        60_000,
        signal,
      ),
    ),
  );
  const stream = streams.success ? streams.data.streams[0] : undefined;
  if (!stream?.codec_name) return null;
  const width = stream.width ?? 0;
  const height = stream.height ?? 0;
  const base = {
    codec: stream.codec_name,
    width,
    height,
    frames: Number(stream.nb_read_packets ?? "1") || 1,
    rotation: 0,
    format: streams.success ? (streams.data.format?.format_name ?? "") : "",
  };
  if (width * height > maxPixels || width <= 0 || height <= 0) return base;
  const frames = imageFrames.safeParse(
    JSON.parse(
      await runTool(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-read_intervals",
          "%+#1",
          "-show_frames",
          "-of",
          "json",
          ...input,
          path,
        ],
        60_000,
        signal,
      ),
    ),
  );
  const rotation = frames.success
    ? (frames.data.frames[0]?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)
    : 0;
  return { ...base, rotation };
}

/**
 * The input options for a background image file: the demuxer from the first bytes, null for none
 * of PNG, JPEG or WebP. An animated PNG is read as `apng` (the `png_pipe` demuxer would show only
 * its first frame, and the ingest refuses an animation by counting frames).
 */
export async function imageInputOfFile(path: string): Promise<readonly string[] | null> {
  const handle = await open(path, "r");
  try {
    const head = new Uint8Array(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const input = imageInput(head.subarray(0, bytesRead));
    if (input?.[1] !== "png_pipe") return input;
    const animated = await pngHasAnimationChunk(handle);
    // A scan that could not reach the image data says nothing: the file is refused.
    if (animated === null) return null;
    return animated ? ["-f", "apng"] : input;
  } finally {
    await handle.close();
  }
}

/** The most chunk headers read before the image data; a PNG with more before it is refused. */
const PNG_CHUNK_SCAN_LIMIT = 1000;

/**
 * Walks the PNG chunk headers up to the first image data: true when `acTL` comes first, false at
 * `IDAT` or `IEND`, null when the scan ends without either (limit, truncated file).
 */
async function pngHasAnimationChunk(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<boolean | null> {
  const header = new Uint8Array(8);
  let offset = 8;
  for (let chunks = 0; chunks < PNG_CHUNK_SCAN_LIMIT; chunks++) {
    const { bytesRead } = await handle.read(header, 0, 8, offset);
    if (bytesRead < 8) return null;
    const type = String.fromCharCode(...header.subarray(4, 8));
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + new DataView(header.buffer).getUint32(0);
  }
  return null;
}
