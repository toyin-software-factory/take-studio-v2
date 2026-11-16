/** How long the browser may take to read a video's length before the upload goes ahead anyway. */
export const DURATION_WAIT_MS = 1500;

/**
 * The length of a video file in seconds, read from its metadata in the browser (advice only: the
 * server check is the authority). Null when it cannot be read in time or at all.
 */
export function readDuration(
  file: Blob,
  waitMs: number = DURATION_WAIT_MS,
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: number | null) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), waitMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}
