import { UPLOAD } from "@/lib/uploads";
import { z } from "zod";

/**
 * The answer of `start_upload` (spec 0019 AC-5). The route `POST /api/uploads` gives the take ID,
 * the part size and the part count; this adds the first batch of presigned part links (what
 * `POST /api/uploads/{takeId}/parts` gives, same shape) and plain steps for the assistant. The
 * server never fetches a file from an address an assistant names: the file goes to R2 by the
 * links, or the creator drops it in the web app. Pure; the links are secrets and are never logged
 * (the dispatch log line holds IDs only).
 */

const created = z.object({
  takeId: z.uuid(),
  partSize: z.number().int().positive(),
  partCount: z.number().int().positive(),
});
export type UploadCreated = z.infer<typeof created>;

const links = z.object({
  parts: z.array(z.object({ partNumber: z.number().int(), url: z.string() })),
  expiresInSeconds: z.number().positive(),
});
export type PartLinks = z.infer<typeof links>;

export const parseCreated = (text: string): UploadCreated | null => {
  try {
    const parsed = created.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const parseLinks = (text: string): PartLinks | null => {
  try {
    const parsed = links.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Part numbers of the first batch: 1 up to the route's limit per request or the part count. */
export const firstBatch = (partCount: number): readonly number[] =>
  Array.from({ length: Math.min(partCount, UPLOAD.maxPartsPerRequest) }, (_, i) => i + 1);

/** The plain text steps. `linked` is how many links came with the answer. */
export function uploadSteps(created: UploadCreated, linked: number, libraryUrl: string): string {
  const send =
    linked > 0
      ? `1. Cut the file into parts of exactly ${created.partSize} bytes (the last part may be smaller). Send part N with an HTTP PUT of its bytes to the link marked partNumber N in "parts". Keep the ETag response header of every PUT.`
      : `1. Call get_upload_part_links with takeId and partNumbers (up to ${UPLOAD.maxPartsPerRequest} at a time). Then cut the file into parts of exactly ${created.partSize} bytes (the last may be smaller) and send part N with an HTTP PUT to its link. Keep the ETag response header of every PUT.`;
  const more =
    created.partCount > linked && linked > 0
      ? `2. This upload has ${created.partCount} parts and the answer holds links for 1 to ${linked}. Call get_upload_part_links for the rest. Links last 15 minutes.`
      : `2. This upload has ${created.partCount} part${created.partCount === 1 ? "" : "s"}. Links last 15 minutes; call get_upload_part_links again for fresh ones.`;
  return [
    send,
    more,
    `3. Call complete_upload with takeId and every part number with its ETag. Processing starts. Follow it with get_take or get_job.`,
    `If you cannot run commands or send files (a plain chat), do not try to send the file yourself. Tell the creator to open ${libraryUrl} and drop the video there, then continue with list_takes. This take can be left alone: call abort_upload to remove it.`,
  ].join("\n");
}

/** The final answer text: the route's fields, the links as given, the steps and the library link. */
export function composeStartUpload(
  created: UploadCreated,
  partLinks: PartLinks | null,
  libraryUrl: string,
): string {
  const linked = partLinks?.parts.length ?? 0;
  return JSON.stringify({
    ...created,
    ...(partLinks ?? {}),
    libraryUrl,
    steps: uploadSteps(created, linked, libraryUrl),
  });
}
