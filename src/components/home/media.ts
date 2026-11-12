/**
 * The homepage's media in `public/home/` (spec 0010, AC-11), extracted from Toyin's draft
 * (`docs/design/home-v2.html`, approved to publish). Each image exists as AVIF, WebP and JPEG at
 * the widths listed; widths above the source's own are not made (no upscaling). Videos exist as
 * MP4 and WebM, with no audio. `media.test.ts` checks every file is there and within budget.
 */

export const HOME_IMAGES = {
  "fan-charcoal": { widths: [480, 500], ratio: [5, 7] },
  "fan-key": { widths: [480, 500], ratio: [5, 7] },
  "fan-captions": { widths: [480, 500], ratio: [5, 7] },
  "fan-studios": { widths: [480, 500], ratio: [5, 7] },
  "fan-ready": { widths: [480, 500], ratio: [5, 7] },
  "fan-upload": { widths: [480, 500], ratio: [5, 7] },
  "fan-library": { widths: [480, 500], ratio: [5, 7] },
  "fan-brick": { widths: [480, 500], ratio: [5, 7] },
  "reel-poster": { widths: [480, 960, 1280], ratio: [16, 9] },
  "studio-blue": { widths: [320], ratio: [16, 9] },
  "studio-charcoal": { widths: [320], ratio: [16, 9] },
  "studio-orange": { widths: [320], ratio: [16, 9] },
  "studio-paper": { widths: [320], ratio: [16, 9] },
  "studio-sage": { widths: [320], ratio: [16, 9] },
  "studio-brick": { widths: [320], ratio: [16, 9] },
  "tile-pauses": { widths: [480, 720], ratio: [1, 1] },
  "tile-studio": { widths: [480, 720], ratio: [3, 4] },
  "tile-transcript": { widths: [480, 720], ratio: [1, 1] },
} as const;

export type HomeImage = keyof typeof HOME_IMAGES;
export type ImageFormat = "avif" | "webp" | "jpg";

export const HOME_VIDEOS = ["reel", "tile-pauses", "tile-studio", "tile-transcript"] as const;
export type HomeVideo = (typeof HOME_VIDEOS)[number];

/** Size limits from spec 0010, AC-11, in bytes. */
export const MEDIA_BUDGET = { tileBytes: 2.5 * 1024 * 1024, reelBytes: 8 * 1024 * 1024 } as const;

export const imagePath = (name: HomeImage, width: number, format: ImageFormat) =>
  `/home/${name}-${width}.${format}`;

/** A `srcset` for one image in one format: `/home/x-480.avif 480w, /home/x-500.avif 500w`. */
export function imageSrcSet(name: HomeImage, format: ImageFormat): string {
  return HOME_IMAGES[name].widths.map((w) => `${imagePath(name, w, format)} ${w}w`).join(", ");
}

/** The largest width of an image: the fallback `src` and the natural size. */
export const largestWidth = (name: HomeImage): number => Math.max(...HOME_IMAGES[name].widths);

export const videoPath = (name: HomeVideo, kind: "mp4" | "webm") => `/home/${name}.${kind}`;
