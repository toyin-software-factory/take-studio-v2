import { ORIGINAL_INPUT, STORED_IMAGE_INPUT } from "@/lib/ffmpeg-input";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  centreDifferenceShare,
  gateReadArgs,
  gateSize,
  isOnlyBackground,
} from "@/lib/background-preview";
import type { HdrTransfer } from "@/lib/probe";
import { type Range, outputFps, renderFilterScript } from "@/lib/trim";
import { MediaToolError, runFfmpeg, runFfmpegBytes } from "./media";

/** What the one render ffmpeg run needs; the same plan is used keyed and plain. */
export type RenderPlan = {
  readonly source: string;
  readonly keep: readonly Range[];
  readonly facts: {
    readonly width: number;
    readonly height: number;
    readonly durationMs: number;
    readonly fps: number | null;
    readonly hdrTransfer: HdrTransfer | null;
    readonly hasAudio: boolean;
  };
  /** The folder for the filter script. */
  readonly work: string;
  readonly output: string;
  /** The background and its key colour, or null for a plain render of the original. */
  readonly background: { readonly imagePath: string; readonly keyColor: string } | null;
  readonly timeoutMs: number;
};

/**
 * Renders the plan with ffmpeg: keyed onto the background when `keyed` (and the plan has one),
 * else the original background. Overwrites `plan.output`.
 */
export async function encodeRender(
  plan: RenderPlan,
  keyed: boolean,
  options: { readonly signal?: AbortSignal; readonly onOutTimeMs?: (ms: number) => void },
): Promise<void> {
  const { facts } = plan;
  const background = keyed ? plan.background : null;
  const script = join(plan.work, "graph.txt");
  await writeFile(
    script,
    renderFilterScript(plan.keep, {
      hdr: facts.hdrTransfer,
      hasAudio: facts.hasAudio,
      size: { width: facts.width, height: facts.height },
      durationMs: facts.durationMs,
      fps: facts.fps,
      background: background
        ? { keyColor: background.keyColor, width: facts.width, height: facts.height }
        : undefined,
    }),
  );
  await runFfmpeg(
    [
      "-y",
      ...ORIGINAL_INPUT,
      "-i",
      plan.source,
      // The background image, looped at the output frame rate, is input 1 of the key graph.
      ...(background
        ? [
            "-loop",
            "1",
            "-framerate",
            outputFps(facts.fps),
            ...STORED_IMAGE_INPUT,
            "-i",
            background.imagePath,
          ]
        : []),
      "-filter_complex_script",
      script,
      "-map",
      "[vout]",
      ...(facts.hasAudio ? ["-map", "[aout]"] : []),
      "-fps_mode",
      "cfr",
      "-r",
      outputFps(facts.fps),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      ...(facts.hdrTransfer
        ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
        : []),
      ...(facts.hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags",
      "+faststart",
      plan.output,
    ],
    { timeoutMs: plan.timeoutMs, signal: options.signal, onOutTimeMs: options.onOutTimeMs },
  );
}

/**
 * The final gate for a full render (RF3-T05, spec 0008 AC-13): reads one frame of the finished
 * output at its middle and the background through the render's own cover chain, both at the
 * preview gate's size, and applies the same test as a preview (`isOnlyBackground` of
 * `centreDifferenceShare`). True means no person is in the output, whatever the cause.
 */
export async function outputIsOnlyBackground(
  input: {
    readonly output: string;
    readonly imagePath: string;
    readonly width: number;
    readonly height: number;
    readonly durationMs: number;
  },
  signal?: AbortSignal,
): Promise<boolean> {
  const gate = gateSize(input.width, input.height);
  const seek = ["-ss", (input.durationMs / 2000).toFixed(3), ...ORIGINAL_INPUT];
  const read = async (args: string[]) => {
    const bytes = await runFfmpegBytes(args, { timeoutMs: 60_000, signal });
    if (bytes.length !== gate.width * gate.height * 3) {
      throw new MediaToolError("ffmpeg", null, false);
    }
    return { width: gate.width, height: gate.height, data: new Uint8Array(bytes) };
  };
  const [frame, backdrop] = await Promise.all([
    read(gateReadArgs(input.output, gate, null, seek)),
    read(
      gateReadArgs(
        input.imagePath,
        gate,
        { width: input.width, height: input.height },
        STORED_IMAGE_INPUT,
      ),
    ),
  ]);
  return isOnlyBackground(centreDifferenceShare(frame, backdrop));
}

/**
 * Renders keyed, checks the output, and when the person was erased renders again without the
 * key (the original background), so a video of only the background is never shipped. The caller
 * records the fallback (`markUnkeyed`) before the file is uploaded. Returns whether the shipped
 * render is keyed.
 */
export async function renderWithFallback(steps: {
  readonly renderKeyed: () => Promise<void>;
  readonly isErased: () => Promise<boolean>;
  readonly markUnkeyed: () => Promise<void>;
  readonly renderPlain: () => Promise<void>;
}): Promise<{ readonly keyed: boolean }> {
  await steps.renderKeyed();
  if (!(await steps.isErased())) return { keyed: true };
  await steps.markUnkeyed();
  await steps.renderPlain();
  return { keyed: false };
}
