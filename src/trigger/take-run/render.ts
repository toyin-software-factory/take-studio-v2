import { join } from "node:path";
import { logger } from "@trigger.dev/sdk";
import { updateStep, whileJobActive } from "@/db/data/jobs";
import { create as createRender, markUncredited, markUnkeyed } from "@/db/data/renders";
import { alignToFrames, keepRanges, throttledProgress, totalMs } from "@/lib/trim";
import { MediaToolError, probeFile } from "../media";
import {
  type RenderPlan,
  creditStartSeconds,
  encodeRender,
  outputIsOnlyBackground,
  renderWithFallback,
} from "../render-fallback";
import type { BackgroundFacts } from "./background";
import {
  CREDIT_ENCODE_TIMEOUT_MS,
  cleanRetryTimeoutMs,
  creditedEncodeMayRetryClean,
  usableCreditImage,
} from "./credit";
import { type RunContext, setStep } from "./context";

/** A finished encode: the render row, the file, and whether the shipped video is keyed. */
export type Encoded = {
  readonly renderId: string;
  readonly output: string;
  readonly expectedMs: number;
  readonly keyed: boolean;
  /** Spec 0026: whether the shipped video carries the credit. */
  readonly credited: boolean;
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
  // Spec 0026 AC-10: the credit is dropped (the render says so) when the image is unusable or
  // the credited encode fails; it never fails the render.
  let credited = created.data.creditApplied;
  const dropCredit = async (reason: "image" | "encode") => {
    credited = false;
    logger.warn("process-take: rendering without the credit", { jobId: job.id, renderId, reason });
    const marked = await whileJobActive(
      client,
      job.id,
      (tx) => markUncredited(tx, { renderId }),
      signal,
    );
    if (!marked.ok) throw new Error(`render markUncredited failed: ${marked.error}`);
  };
  const creditImage = credited ? await usableCreditImage() : null;
  if (credited && !creditImage) await dropCredit("image");
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
    credit: creditImage ? { pngPath: creditImage, timeoutMs: CREDIT_ENCODE_TIMEOUT_MS } : null,
  };
  const renderProgress = throttledProgress((p) => setStep(ctx, "render", "running", p));
  // Encoding is most of the render step; the upload takes the last few points.
  const onOutTimeMs = (ms: number) => void renderProgress.report((ms / expectedMs) * 95);
  let retriedClean = false;
  const encodeStartedAt = Date.now();
  const run = async (asKeyed: boolean) => {
    if (credited) {
      try {
        return await encodeRender(plan, asKeyed, { signal, onOutTimeMs });
      } catch (error) {
        if (!creditedEncodeMayRetryClean(error)) throw error;
        retriedClean = true;
        await dropCredit("encode");
      }
    }
    // After a failed credited encode the clean one gets what is left of the 38 minutes.
    const clean = retriedClean
      ? { ...plan, timeoutMs: cleanRetryTimeoutMs(plan.timeoutMs, Date.now() - encodeStartedAt) }
      : plan;
    return encodeRender(clean, asKeyed, { signal, onOutTimeMs, credit: false });
  };
  let shippedKeyed = keyed;
  if (keyed && backgroundFacts) {
    // RF3-T05 (spec 0008 AC-13): a keyed output that is only the background has no person in
    // it; it is never shipped. Render again without the key and record that on the render row.
    const imagePath = backgroundFacts.imagePath;
    const result = await renderWithFallback({
      renderKeyed: () => run(true),
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
            // Spec 0026 AC-11: read before the credit, which would cover the centre of a short clip.
            creditStartSeconds: plan.credit && credited ? creditStartSeconds(plan) : undefined,
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
      renderPlain: () => run(false),
    });
    shippedKeyed = result.keyed;
  } else {
    await run(false);
  }
  return {
    renderId,
    output,
    expectedMs,
    keyed: shippedKeyed,
    credited,
    flushProgress: renderProgress.flush,
  };
}
