import { z } from "zod";
import { buildCues, toPlainText, toSrt, toVtt, type TrimmedParagraph } from "./transcript-timeline";

/**
 * What the transcript download route sends (spec 0007, AC-4, AC-5): the three formats, the file
 * body, and headers with a safe file name. Pure, so the route stays a thin edge.
 */

export const downloadFormatSchema = z.enum(["txt", "srt", "vtt"]);
export type DownloadFormat = z.infer<typeof downloadFormatSchema>;

const CONTENT_TYPES: Record<DownloadFormat, string> = {
  txt: "text/plain; charset=utf-8",
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
};

/** The text and SRT are saved; the WebVTT is the player's caption track and is shown inline. */
const DISPOSITIONS: Record<DownloadFormat, "attachment" | "inline"> = {
  txt: "attachment",
  srt: "attachment",
  vtt: "inline",
};

const MAX_TITLE_CHARS = 200;

/** The title as a file name stem: no controls or path characters, at most 200 characters. */
function fileStem(title: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_CHARS)
    .trim();
  return cleaned === "" ? "take" : cleaned;
}

/** ASCII only, for the plain `filename` parameter: accents folded, anything else an underscore. */
function asciiStem(stem: string): string {
  const folded = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[ ._]+|[ ._]+$/g, "");
  return folded === "" ? "take" : folded;
}

/** RFC 5987 percent encoding for `filename*`. */
function encodeStar(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(format: DownloadFormat, title: string): string {
  const stem = fileStem(title);
  return `${DISPOSITIONS[format]}; filename="${asciiStem(stem)}.${format}"; filename*=UTF-8''${encodeStar(`${stem}.${format}`)}`;
}

export function downloadHeaders(format: DownloadFormat, title: string): Record<string, string> {
  return {
    "Content-Type": CONTENT_TYPES[format],
    "Content-Disposition": contentDisposition(format, title),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

/** The file body, or null when there is nothing to download (no kept, non filler words). */
export function downloadBody(
  format: DownloadFormat,
  paragraphs: readonly TrimmedParagraph[],
): string | null {
  if (format === "txt") {
    const text = toPlainText(paragraphs);
    return text === "" ? null : text;
  }
  const cues = buildCues(paragraphs);
  if (cues.length === 0) return null;
  return format === "srt" ? toSrt(cues) : toVtt(cues);
}
