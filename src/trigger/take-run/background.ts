import { join } from "node:path";
import { eq } from "drizzle-orm";
import { background } from "@/db/schema";
import { updateStep } from "@/db/data/jobs";
import { toHex } from "@/lib/keying";
import { R2DownloadError, downloadToFile } from "@/lib/r2-file-upload";
import { BackgroundMissingError, detectInFile } from "../keying";
import { type RunContext, setStep } from "./context";

/** The chosen background, downloaded, and the key colour found in the take (null: no green). */
export type BackgroundFacts = {
  readonly id: string;
  readonly name: string;
  readonly imagePath: string;
  readonly keyColor: string | null;
};

/**
 * The `background` step (spec 0008): find the green screen and its colour; none usable keeps the
 * original background and the step ends skipped. Null when the job has no target background.
 */
export async function prepareBackground(ctx: RunContext): Promise<BackgroundFacts | null> {
  const { client, job, r2, signal, source, facts, work } = ctx;
  if (!job.targetBackgroundId) return null;
  await setStep(ctx, "background", "running", 0);
  const [bg] = await client
    .select()
    .from(background)
    .where(eq(background.id, job.targetBackgroundId));
  if (!bg || bg.status !== "ready" || !bg.imageKey) throw new BackgroundMissingError();
  const imagePath = join(work, "background.jpg");
  try {
    await downloadToFile(
      await r2.presignGet(bg.imageKey, { expiresSeconds: 60 * 60 }),
      imagePath,
      signal,
    );
  } catch (error) {
    // The row is ready but its image is gone from R2: the job's own code (spec 0008).
    if (error instanceof R2DownloadError && error.status === 404) {
      throw new BackgroundMissingError();
    }
    throw error;
  }
  const detection = await detectInFile(source, facts, signal);
  const found: BackgroundFacts = {
    id: bg.id,
    name: bg.name,
    imagePath,
    keyColor: detection.usable ? toHex(detection.keyColor) : null,
  };
  if (detection.usable) {
    await setStep(ctx, "background", "succeeded", 100);
  } else {
    await updateStep(client, {
      jobId: job.id,
      name: "background",
      status: "skipped",
      progress: 0,
      failureCode: "no_green_screen",
    });
  }
  return found;
}
