import { execFileSync } from "node:child_process";
import { alignToFrames } from "../../src/lib/trim";
import { media } from "./api";

/**
 * The length the render of a fixture must have, worked out from the fixture alone (its own file
 * and its expected cut list), never from what the run returned, so a render that drifts from its
 * plan still fails. The kept ranges are what the cuts leave, snapped outward to the frame grid
 * by the real `alignToFrames`.
 */
export function plannedLengthMs(
  file: string,
  cuts: readonly (readonly [number, number])[],
  /** For a file whose header has no duration (a Chrome recording): the length it was made with. */
  knownDurationMs?: number,
): number {
  const source = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate:format=duration",
        "-print_format",
        "json",
        media(file),
      ],
      { encoding: "utf8" },
    ),
  ) as { streams: { avg_frame_rate: string }[]; format: { duration: string } };
  const durationMs = knownDurationMs ?? Math.round(Number(source.format.duration) * 1000);
  const [n, d] = (source.streams[0]?.avg_frame_rate ?? "30/1").split("/").map(Number);
  const fps = (n ?? 30) / (d || 1);

  const keep: { startMs: number; endMs: number }[] = [];
  let at = 0;
  for (const [start, end] of [...cuts].sort((x, y) => x[0] - y[0])) {
    if (start > at) keep.push({ startMs: at, endMs: start });
    at = Math.max(at, end);
  }
  if (durationMs > at) keep.push({ startMs: at, endMs: durationMs });
  return alignToFrames(keep, fps).reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
}
