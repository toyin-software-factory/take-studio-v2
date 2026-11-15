import { builtInTracker } from "@/db/testing/test-db";
import { type AfterDelete } from ".";

export const SECRET = "test-usage-hash-secret-0123456789abcdef";
export const built = builtInTracker();
/** Records the post commit side effects instead of calling Trigger.dev. */
export function spyAfter() {
  const calls = { cancelled: [] as string[], drains: 0 };
  const after: AfterDelete = {
    cancelRuns: async (ids) => void calls.cancelled.push(...ids),
    requestStorageDrain: async () => void calls.drains++,
  };
  return { calls, after };
}
