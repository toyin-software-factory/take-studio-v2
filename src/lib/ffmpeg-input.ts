/**
 * Input format pins for ffmpeg and ffprobe (RF3-T04, defence in depth). Left alone, the tools pick
 * a demuxer from the file's content, so a creator's upload could make them open some other kind
 * of input. Every input option here goes before the `-i` (or the ffprobe input) it applies to.
 */

/** The original upload: only MP4 and MOV pass the probe, and both are the mov demuxer. */
export const ORIGINAL_INPUT: readonly string[] = ["-f", "mov"];

/**
 * The demuxer for a background image, chosen from its first bytes: `png_pipe`, `webp_pipe`,
 * `jpeg_pipe`, or null when the bytes are none of those (the caller refuses the file).
 * ffprobe reports a JPEG file as `image2`, but `jpeg_pipe` reads the same bytes.
 */
export function imageDemuxer(head: Uint8Array): "png_pipe" | "webp_pipe" | "jpeg_pipe" | null {
  const at = (i: number, bytes: readonly number[]) => bytes.every((b, k) => head[i + k] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png_pipe";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "webp_pipe";
  if (at(0, [0xff, 0xd8, 0xff])) return "jpeg_pipe";
  return null;
}

/** Input options for a background image from its first bytes. */
export function imageInput(head: Uint8Array): readonly string[] | null {
  const demuxer = imageDemuxer(head);
  return demuxer ? ["-f", demuxer] : null;
}

/**
 * A stored background or preview still: the ingest always writes a JPEG file (`image.jpg`, the
 * built in studios too) and the preview a JPEG, which the `image2` demuxer reads (it is also the
 * demuxer that has the `-loop` option the render uses).
 */
export const STORED_IMAGE_INPUT: readonly string[] = ["-f", "image2"];

/**
 * The same stored JPEG read over HTTP: `image2` does not take the HTTP options (`-rw_timeout` is
 * refused as an unknown option), `jpeg_pipe` reads the same bytes and does.
 */
export const STORED_IMAGE_URL_INPUT: readonly string[] = ["-f", "jpeg_pipe"];
