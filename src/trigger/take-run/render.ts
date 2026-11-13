import { join } from "node:path";
import { logger } from "@trigger.dev/sdk";
import { updateStep, whileJobActive } from "@/db/data/jobs";
import { create as createRender, markUnkeyed } from "@/db/data/renders";
import { alignToFrames, keepRanges, throttledProgress, totalMs } from "@/lib/trim";
import { MediaToolError, probeFile } from "../media";
import {
  type RenderPlan,
  encodeRender,
  outputIsOnlyBackground,
  renderWithFallback,
} from "../render-fallback";
import type { BackgroundFacts } from "./background";
import { type RunContext, setStep } from "./context";

/** A finished encode: the render row, the file, and whether the shipped video is keyed. */
export type Encoded = {
  readonly renderId: string;
  readonly output: string;
  readonly expectedMs: number;
  readonly keyed: boolean;
  readonly flushProgress: () => Promise<void>;
};

/**
 * The render step up to the encoded file: creates the render row from the applied cuts, encodes
 * (keyed, or plain), and for a keyed render runs the final gate (RF3-T05, spec 0008 AC-13).
 */
export async function encode(
  ctx: RunContext,
  backgroundFacts: BackgroundFacts | null,
): Promise<Encoded> {
  const { client, job, signal, source, facts, work } = ctx;
  const keyed = backgroundFacts?.keyColor != null;
  await setStep(ctx, "render", "running", 0);
  const created = await whileJobActive(
    client,
    job.id,
    (tx) =>
      createRender(tx, {
        takeId: ctx.take.id,
        jobId: job.id,
        background: backgroundFacts
          ? {
              backgroundId: backgroundFacts.id,
              backgroundName: backgroundFacts.name,
              keyed,
              keyColor: backgroundFacts.keyColor,
            }
          : undefined,
      }),
    signal,
  );
  if (!created.ok) throw new Error(`render create failed: ${created.error}`);
  const renderId = created.data.id;
  const keep = alignToFrames(keepRanges(created.data.removedRanges, facts.durationMs), facts.fps);
  if (keep.length === 0) {
    // Every range collapsed when snapped to frames: nothing would be left to render.
    throw new Error("render has nothing to keep: the cuts remove the whole take");
  }
  const expectedMs = totalMs(keep);
  const output = join(work, "render.mp4");
  const plan: RenderPlan = {
    source,
    keep,
    facts,
    work,
    output,
    background:
      keyed && backgroundFacts?.keyColor
        ? { imagePath: backgroundFacts.imagePath, keyColor: backgroundFacts.keyColor }
        : null,
    timeoutMs: 38 * 60_000,
  };
  const renderProgress = throttledProgress((p) => setStep(ctx, "render", "running", p));
  // Encoding is most of the render step; the upload takes the last few points.
  const onOutTimeMs = (ms: number) => void renderProgress.report((ms / expectedMs) * 95);
  let shippedKeyed = keyed;
  if (keyed && backgroundFacts) {
    // RF3-T05 (spec 0008 AC-13): a keyed output that is only the background has no person in
    // it; it is never shipped. Render again without the key and record that on the render row.
    const imagePath = backgroundFacts.imagePath;
    const result = await renderWithFallback({
      renderKeyed: () => encodeRender(plan, true, { signal, onOutTimeMs }),
      isErased: async () => {
        const probed = await probeFile(output, signal);
        if (!probed) throw new MediaToolError("ffprobe", null, false);
        return outputIsOnlyBackground(
          {
            output,
            imagePath,
            width: facts.width,
            height: facts.height,
            durationMs: probed.durationMs,
          },
          signal,
        );
      },
      markUnkeyed: async () => {
        logger.warn("process-take: keyed render is only the background, rendering without key", {
          jobId: job.id,
          takeId: ctx.take.id,
          renderId,
          backgroundId: backgroundFacts.id,
        });
        const marked = await whileJobActive(
          client,
          job.id,
          (tx) => markUnkeyed(tx, { renderId }),
          signal,
        );
        if (!marked.ok) throw new Error(`render markUnkeyed failed: ${marked.error}`);
        await updateStep(client, {
          jobId: job.id,
          name: "background",
          status: "skipped",
          progress: 0,
          failureCode: "no_green_screen",
        });
      },
      renderPlain: () => encodeRender(plan, false, { signal, onOutTimeMs }),
    });
    shippedKeyed = result.keyed;
  } else {
    await encodeRender(plan, false, { signal, onOutTimeMs });
  }
  return { renderId, output, expectedMs, keyed: shippedKeyed, flushProgress: renderProgress.flush };
}
