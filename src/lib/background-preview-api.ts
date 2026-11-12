import { z } from "zod";

/** POST and GET /api/takes/{id}/background/preview (spec 0008, AC-4). */
export const previewViewSchema = z.object({
  state: z.enum(["making", "ready", "failed"]),
  url: z.string().optional(),
  noGreenScreen: z.boolean().default(false),
});
export type PreviewView = z.infer<typeof previewViewSchema>;

/** About 90 s of 2 s checks (the server stops a preview after 2 minutes). */
export const PREVIEW_CHECKS = 45;
