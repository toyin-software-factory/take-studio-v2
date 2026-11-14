import { z } from "zod";

/**
 * The public site's fixed facts (spec 0010): name, one line description, the one contact address
 * and the site origin. Pure; the page, the metadata, the JSON-LD, robots and sitemap all read these.
 */

export const SITE_NAME = "Take Studio";

/** Contact for questions (Toyin, 2026-11-12). One constant, used by the page and the footer. */
export const CONTACT_EMAIL = "hello@takestudio.app";

export const SITE_TITLE = "Film one take. Get it back ready to post.";

export const SITE_DESCRIPTION =
  "Upload a video and Take Studio trims the pauses, swaps your green screen for a studio and writes captions that match the cut.";

/**
 * The site origin from `BETTER_AUTH_URL` (the app's own address), without a trailing slash, or
 * null when it is missing or not a URL (the page then leaves absolute URLs out instead of
 * guessing a host).
 */
export function siteOrigin(value: string | undefined): string | null {
  const parsed = z.url().safeParse(value);
  return parsed.success ? new URL(parsed.data).origin : null;
}

/** Paths that must stay out of search results: the app, the design gallery and the API. */
export const PRIVATE_PATHS = [
  "/takes",
  "/library",
  "/design",
  "/account",
  "/api/",
  "/emails",
  "/sign-in",
] as const;
