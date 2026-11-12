/**
 * The one rule for "this take's video has expired" (spec 0004, AC-7; spec 0002, AC-17): the
 * expiry time has been reached. `null` (the upload has not completed, so no expiry is set) is
 * never expired, and a time equal to `now` counts as expired. The cleanup sweep may lag by up to
 * 15 minutes, so everything that decides on expiry (pages, routes, job starts, previews) calls
 * this instead of writing the comparison out, and the take's `expired` status adds to it
 * (`isExpired` in `take-media.ts`). Accepts a `Date` or an ISO string (the browser has strings).
 */
export function isVideoExpired(videoExpiresAt: Date | string | null, now: Date): boolean {
  return videoExpiresAt !== null && new Date(videoExpiresAt).getTime() <= now.getTime();
}
