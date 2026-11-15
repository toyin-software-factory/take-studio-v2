/** After the steps: clean up a failed run, then the revoke step (moved out of api-real-run.ts). */
import {
  api,
  codeOf,
  pollUntil,
  revokeSeconds,
  state,
  step,
  stop,
  type Run,
} from "./api-real-run-core";

export async function finish(run: Run): Promise<void> {
  // A failed run still cleans up: an upload in progress is cancelled, a take is deleted.
  const left = run.takeId;
  if (left !== null) {
    // An upload still open is aborted first (409 means the object already exists). Either way the
    // take itself is then deleted, so a failed run leaves nothing behind.
    if (!run.completed) {
      const abort = await api("DELETE", `/api/uploads/${left}`).catch(() => null);
      console.log(`CLEAN abort ${left}  HTTP ${abort?.status ?? "none"}`);
    }
    const removed = await api("DELETE", `/api/takes/${left}`).catch(() => null);
    console.log(`CLEAN delete ${left}  HTTP ${removed?.status ?? "none"}`);
    if (removed === null || ![200, 204, 404].includes(removed.status)) process.exitCode = 1;
  }

  if (!state.failed) {
    console.log(
      "\nREVOKE  In the web app open the account menu, API keys, and revoke the key used for this run.\n" +
        `        Waiting up to ${revokeSeconds} s for the key to be refused.`,
    );
  }
  await step("revoke: the key is refused after the creator revokes it", async () => {
    const reply = await pollUntil(
      () => api("GET", "/api/usage"),
      (r) => r.status === 401,
      revokeSeconds,
    );
    if (reply === null) return stop(200, `the key still works after ${revokeSeconds} s`);
    if (codeOf(reply) !== "invalid_api_key") return stop(401, `refused with ${codeOf(reply)}`);
    return { status: 401, note: "invalid_api_key" };
  });
}
