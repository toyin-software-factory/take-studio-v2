/**
 * Background checks for the pipeline run (spec 0008 build plan step 7): a studio chosen at
 * upload and keyed in the video job (AC-2), a take with no green screen (AC-3), previews (AC-4),
 * re renders that keep the take Ready and charge nothing (AC-5, AC-6), uploaded backgrounds with
 * the refusals that need real R2 (AC-8, AC-9) and their deletion (AC-10). Real R2 and
 * Trigger.dev dev, tiny synthetic fixtures. Called from run.ts with its helpers, so the services
 * and the creators are shared. The sections live in background-uploads.ts, background-takes.ts,
 * background-change.ts and background-delete.ts; background-env.ts holds what they share.
 */
import { type Ctx, makeEnv } from "./background-env";
import { changeScenarios } from "./background-change";
import { deleteScenarios } from "./background-delete";
import { takeScenarios } from "./background-takes";
import { uploadScenarios } from "./background-uploads";

export type { Ctx };

export async function backgroundScenarios(ctx: Ctx): Promise<void> {
  const env = makeEnv(ctx);
  const warm = await uploadScenarios(env);
  const keyed = await takeScenarios(env);
  await changeScenarios(env, keyed, warm);
  await deleteScenarios(env, keyed, warm);
}
