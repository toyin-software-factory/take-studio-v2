import { parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { triggerPreview } from "@/lib/trigger-runs";
import { transcriptHttpDeps } from "../takes/deps";
import type { PreviewHttpDeps } from "./preview-http";

/** The real dependencies of the preview routes: the session, the app origin, Trigger.dev and R2. */
export function previewHttpDeps(): PreviewHttpDeps {
  const r2 = createR2(parseWebEnv());
  return {
    ...transcriptHttpDeps(),
    triggerPreview,
    presignGet: (key, options) => r2.presignGet(key, options),
  };
}
