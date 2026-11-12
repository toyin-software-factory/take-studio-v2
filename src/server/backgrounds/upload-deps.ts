import { parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { requestStorageDrain, triggerIngest } from "@/lib/trigger-runs";
import { transcriptHttpDeps } from "../takes/deps";
import type { UploadHttpDeps } from "./upload-http";

/** The real dependencies of the upload and delete routes: session, origin, R2 and Trigger.dev. */
export function uploadHttpDeps(): UploadHttpDeps {
  const r2 = createR2(parseWebEnv());
  return {
    ...transcriptHttpDeps(),
    ports: (db) => ({
      db,
      presignPut: (key, contentType, bytes) => r2.presignPutObject(key, contentType, bytes),
      headObject: (key) => r2.headObject(key),
      triggerIngest,
    }),
    requestDrain: requestStorageDrain,
  };
}
