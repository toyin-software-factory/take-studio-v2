import { z } from "zod";

/** POST and GET /api/takes/{id}/background/preview (spec 0008, AC-4). */
export const previewViewSchema = z.object({
  state: z.enum(["making", "ready", "failed"]),
  url: z.string().optional(),
  noGreenScreen: z.boolean().default(false),
});
export type PreviewView = z.infer<typeof previewViewSchema>;

/** How long the page waits for a preview while the tab is visible (the server gives up at 2 minutes). */
export const PREVIEW_WAIT_MS = 90_000;
/** Requests that fail in a row before the page stops asking. */
export const PREVIEW_MAX_FAILURES = 3;
