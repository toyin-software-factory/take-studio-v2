import { parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { transcriptHttpDeps } from "../takes/deps";
import type { BackgroundHttpDeps } from "./http";

/** The real dependencies of the backgrounds routes: the session, the app origin and R2. */
export function backgroundHttpDeps(): BackgroundHttpDeps {
  const r2 = createR2(parseWebEnv());
  return { ...transcriptHttpDeps(), presignGet: (key, options) => r2.presignGet(key, options) };
}
