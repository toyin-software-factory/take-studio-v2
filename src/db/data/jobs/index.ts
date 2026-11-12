/**
 * System functions for processing jobs (spec 0002, API surface), split by job kind. Imports go
 * through this file (`@/db/data/jobs`). Map in src/db/AGENTS.md.
 */
export { type StartedJob, type FinishStatus, type FinishResult, type FinishError } from "./types";
export { markRunning, updateStep } from "./steps";
export { flipLatestRender, discardJobRenders, queueDeletions } from "./render-files";
export { whileJobActive } from "./locks";
export { finish, finishInTx } from "./finish";
export { type StartError, startJob } from "./initial";
export { type TranscribeStartError, startTranscribeJob } from "./transcribe";
export {
  type BackgroundStartError,
  legacyBackgroundRerender,
  startBackgroundJob,
} from "./background";
