/**
 * The /design gallery exists only in development and preview builds (spec 0003, AC-7).
 * Preview builds are production builds too, so they opt in with the Worker variable
 * `DESIGN_GALLERY=1` (passed by the Playwright web server and `pnpm preview`).
 * The live Worker never sets it, so production returns not found.
 */
export function isGalleryEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NODE_ENV === "development" || env.DESIGN_GALLERY === "1";
}
