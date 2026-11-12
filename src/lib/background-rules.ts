/**
 * Rules for the backgrounds a creator uploads (spec 0008, AC-8 to AC-10, Pipeline step 5).
 * Pure: limits, keys, failure codes with their friendly messages, and the check of an image's
 * facts. The browser checks the type and size up front, but only ingest decides validity.
 */

const MiB = 1024 * 1024;

export const BACKGROUND_UPLOAD = {
  /** The accepted file types, as the upload declares them. */
  contentTypes: ["image/jpeg", "image/png", "image/webp"],
  maxBytes: 10 * MiB,
  /** Uploads started per creator per hour (counting failed ones). */
  perHour: 20,
  /** Backgrounds a creator can keep. */
  libraryCap: 100,
  /** The presigned upload link lifetime. */
  linkSeconds: 15 * 60,
  /** A row still `uploading` or `processing` after this long is failed by cleanup. */
  stuckAfterMs: 60 * 60 * 1000,
  /**
   * How long a deleted, still `uploading` background is kept hidden (the link's lifetime plus a
   * margin): a PUT sent before the link expired could still write the source file, so its keys
   * are queued again when this has passed.
   */
  removedKeepMs: 15 * 60 * 1000 + 5 * 60 * 1000,
} as const;

export const BACKGROUND_IMAGE = {
  minWidth: 1280,
  minHeight: 720,
  /** More than this is refused before anything is decoded (a decompression bomb). */
  maxPixels: 40_000_000,
  /** The stored image is fitted inside this box (never enlarged). */
  maxWidth: 3840,
  maxHeight: 2160,
  thumbWidth: 480,
  thumbHeight: 270,
  /** ffprobe codec names we accept; anything else is not a still JPEG, PNG or WebP. */
  codecs: ["mjpeg", "png", "webp"],
  /**
   * ffprobe container names of a still image file (a JPEG is `image2`). A one frame AVI or MOV
   * holding MJPEG has the right codec but is a video file, so the container is checked too.
   */
  formats: ["image2", "jpeg_pipe", "png_pipe", "webp_pipe"],
} as const;

export type BackgroundContentType = (typeof BACKGROUND_UPLOAD.contentTypes)[number];

export function isBackgroundContentType(value: string): value is BackgroundContentType {
  return (BACKGROUND_UPLOAD.contentTypes as readonly string[]).includes(value);
}

/** Why ingest refused an image (`background.failure_code`). An open set: add, never rename. */
export const BACKGROUND_FAILURE_MESSAGES = {
  image_invalid: "That file isn't a JPEG, PNG or WebP image. Choose a different image.",
  image_animated: "Animated images can't be used. Choose a still JPEG, PNG or WebP image.",
  image_too_small: "That image is too small. Use one at least 1280 by 720 pixels.",
  image_too_large:
    "That image is too large. Use one under 10 MB and under 40 megapixels (for example 8000 by 5000).",
  upload_incomplete: "The upload didn't finish. Please try again.",
  /** Hidden from the library: deleted while the upload link was still valid (see `removedKeepMs`). */
  removed: "This image was removed.",
  ingest_error: "We couldn't process that image. Please try again.",
} as const;

export type BackgroundFailureCode = keyof typeof BACKGROUND_FAILURE_MESSAGES;

export function backgroundFailureMessage(code: string | null): string {
  return code && Object.hasOwn(BACKGROUND_FAILURE_MESSAGES, code)
    ? BACKGROUND_FAILURE_MESSAGES[code as BackgroundFailureCode]
    : BACKGROUND_FAILURE_MESSAGES.ingest_error;
}

/** The three files of an uploaded background; keys are fixed by creator and ID. */
export function backgroundKeys(creatorId: string, backgroundId: string) {
  const base = `backgrounds/${creatorId}/${backgroundId}`;
  return {
    sourceKey: `${base}/source`,
    imageKey: `${base}/image.jpg`,
    thumbKey: `${base}/thumb.webp`,
  };
}

/** What ffprobe says about the first video stream of an image. */
export type ImageFacts = {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  /** Frames in the file; more than one means animated. */
  readonly frames: number;
  /** The EXIF or display matrix rotation in degrees (0, 90, 180, 270). */
  readonly rotation: number;
  /** ffprobe's container name (`image2`, `png_pipe`, `webp_pipe`, `avi`, ...). */
  readonly format: string;
};

/** The size as it displays, after the rotation is applied. */
export function displaySize(facts: Pick<ImageFacts, "width" | "height" | "rotation">) {
  const turned = Math.abs(facts.rotation) % 180 === 90;
  return turned
    ? { width: facts.height, height: facts.width }
    : { width: facts.width, height: facts.height };
}

/**
 * The first rule an image breaks, or null. The order matters: the type first, then animation,
 * then the pixel count (before any decoding), then the minimum size.
 */
export function checkImageFacts(facts: ImageFacts): BackgroundFailureCode | null {
  if (facts.codec === "apng") return "image_animated";
  if (!(BACKGROUND_IMAGE.codecs as readonly string[]).includes(facts.codec)) return "image_invalid";
  if (!(BACKGROUND_IMAGE.formats as readonly string[]).includes(facts.format))
    return "image_invalid";
  if (facts.frames > 1) return "image_animated";
  if (!(facts.width > 0) || !(facts.height > 0)) return "image_invalid";
  if (facts.width * facts.height > BACKGROUND_IMAGE.maxPixels) return "image_too_large";
  const shown = displaySize(facts);
  if (shown.width < BACKGROUND_IMAGE.minWidth || shown.height < BACKGROUND_IMAGE.minHeight) {
    return "image_too_small";
  }
  return null;
}

/**
 * True for an animated WebP, read from the first bytes of the file: ffprobe cannot read the
 * size of an animated WebP, so the container flag is checked first. `RIFF` size `WEBP`, then a
 * `VP8X` chunk whose flags byte has the animation bit (0x02).
 */
export function isAnimatedWebp(head: Uint8Array): boolean {
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.length < 21) return false;
  if (text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP" || text(12, 16) !== "VP8X") return false;
  return ((head[20] ?? 0) & 0x02) !== 0;
}

/**
 * The ffmpeg filter that turns an image upright from the rotation ffprobe reports for its first
 * frame (an EXIF orientation as a display matrix): -90 is turned a quarter clockwise to read
 * upright, 90 the other way, 180 both flips. Empty for an upright image. ffmpeg applies this
 * itself only in simple filter graphs, so the ingest does it explicitly (with `-noautorotate`).
 */
export function rotationFilter(rotation: number): string {
  const turn = ((Math.round(rotation) % 360) + 360) % 360;
  if (turn === 270) return "transpose=clock,";
  if (turn === 90) return "transpose=cclock,";
  if (turn === 180) return "hflip,vflip,";
  return "";
}
