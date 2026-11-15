/**
 * One command real run of the public API by key (spec 0018 build step 9, B2-T110): from an
 * upload to a download, then the key is revoked. It uses only the routes /api/openapi.json lists,
 * on a committed synthetic speech clip (`tests/fixtures/media/speech-en.mp4`, a text to speech
 * voice, never a creator's video).
 *
 * Usage:
 *   TAKE_API_KEY=tsk_… pnpm check:api-run                       (base from API_BASE_URL, else localhost:3000)
 *   TAKE_API_KEY=tsk_… API_BASE_URL=https://… pnpm check:api-run -- --allow-remote
 *
 * Options: `--base <url>`, `--wait <seconds>` for the take to be ready (default 600),
 * `--revoke-wait <seconds>` for you to revoke the key in the web app (default 300),
 * `--allow-remote` for a base that is not localhost.
 *
 * Every step prints PASS or FAIL with the HTTP status and a short reason. A failure stops the
 * run, the take is still deleted, and the exit code is 1. The key is read from the environment
 * and never printed. Part links and download links are secrets: they are used and dropped, never
 * logged. Only IDs, statuses, sizes and content types are printed.
 *
 * Key create and revoke are session only (spec 0018), so there is no key route to call: the last
 * step prints what to click and then polls until the key is refused.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { RESPONSE_SCHEMAS } from "../src/lib/api-schemas/responses";

const args = process.argv.slice(2);
/** The operand of `--name`, or undefined when the flag is absent. A flag with no operand is an error. */
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value.`);
  return value;
};
const seconds = (name: string, fallback: number): number => {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} is a whole number of seconds, 0 or more.`);
  return Number(raw);
};
const base = (flag("base") ?? process.env.API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const waitSeconds = seconds("wait", 600);
const revokeSeconds = seconds("revoke-wait", 300);
const key = z
  .string()
  .regex(/^tsk_[A-Za-z0-9_-]{43}$/, "Set TAKE_API_KEY to an API key (tsk_…).")
  .parse(process.env.TAKE_API_KEY);
const local = ["localhost", "127.0.0.1"].includes(new URL(base).hostname);
if (!local && !args.includes("--allow-remote")) {
  throw new Error("The base URL is not localhost. Pass --allow-remote to run against it.");
}
if (!local && new URL(base).protocol !== "https:") {
  throw new Error("The base URL must use https:// unless it is localhost (the key is a header).");
}
if (![waitSeconds, revokeSeconds].every((n) => Number.isFinite(n) && n >= 0)) {
  throw new Error("--wait and --revoke-wait are seconds, 0 or more.");
}

const REQUEST_TIMEOUT_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A step failed: the HTTP status (0 when there was none) and a reason with no secret in it. */
class StepFailed extends Error {
  constructor(
    readonly status: number,
    reason: string,
  ) {
    super(reason);
  }
}
const stop = (status: number, reason: string): never => {
  throw new StepFailed(status, reason);
};

type Reply = { status: number; json: unknown; headers: Headers };

/** One API call with the key. The body is read as JSON when it is JSON, else left null. */
async function api(method: string, path: string, body?: unknown, auth = true): Promise<Reply> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${key}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

/** The route's error code (`not_found`, `invalid_api_key`), only when it is a plain code. */
function codeOf(reply: Reply): string {
  const parsed = z.object({ error: z.string().regex(/^[a-z_]{1,40}$/) }).safeParse(reply.json);
  return parsed.success ? parsed.data.error : "no error code";
}

/** The body as the documented response schema says, or a failed step. */
function shaped<N extends keyof typeof RESPONSE_SCHEMAS>(
  name: N,
  reply: Reply,
  want = 200,
): z.infer<(typeof RESPONSE_SCHEMAS)[N]> {
  if (reply.status !== want) stop(reply.status, `expected ${want}, got ${codeOf(reply)}`);
  const parsed = RESPONSE_SCHEMAS[name].safeParse(reply.json);
  if (!parsed.success)
    stop(reply.status, `the body does not match ${name} in the OpenAPI document`);
  return parsed.data as z.infer<(typeof RESPONSE_SCHEMAS)[N]>;
}

const results: { name: string; ok: boolean }[] = [];
let failed = false;

/** Runs one step. After a failure the later steps do not run (they would only repeat it). */
async function step(name: string, run: () => Promise<{ status: number; note: string }>) {
  if (failed) return;
  try {
    const { status, note } = await run();
    console.log(`PASS  ${name}  HTTP ${status}  ${note}`);
    results.push({ name, ok: true });
  } catch (error) {
    failed = true;
    results.push({ name, ok: false });
    const status = error instanceof StepFailed ? error.status : 0;
    // Only our own reasons are printed; an unknown error is named by its kind, never its text.
    const reason = error instanceof StepFailed ? error.message : `${errorKind(error)}`;
    console.log(`FAIL  ${name}  HTTP ${status || "none"}  ${reason}`);
  }
}

function errorKind(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "the request timed out";
  return "the request did not complete";
}

async function pollUntil<T>(read: () => Promise<T>, done: (v: T) => boolean, seconds: number) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) return null;
    await sleep(3_000);
  }
}

type Detail = z.infer<typeof RESPONSE_SCHEMAS.TakeDetail>;
const readTake = async (id: string): Promise<Detail> =>
  shaped("TakeDetail", await api("GET", `/api/takes/${id}`));

/** Starts a render with these cut choices and waits for its job; returns the take after it. */
async function changeCuts(
  takeId: string,
  cuts: { id: string; applied: boolean }[],
): Promise<{ status: number; detail: Detail }> {
  const before = await readTake(takeId);
  const started = await api("POST", `/api/takes/${takeId}/changes`, {
    baseRenderId: before.latestRender?.id ?? null,
    cuts,
  });
  const { jobId } = shaped("JobStarted", started, 202 as number);
  const job = await pollUntil(
    async () => shaped("JobStatus", await api("GET", `/api/takes/${takeId}/jobs/${jobId}`)),
    (j) => ["succeeded", "failed", "cancelled"].includes(j.status),
    waitSeconds,
  );
  if (job?.status !== "succeeded") stop(200, `the change job ended ${job?.status ?? "late"}`);
  return { status: started.status, detail: await readTake(takeId) };
}

/** Fetches a link and checks it has bytes and the wanted content type. Prints no link. */
async function checkDownload(url: string, typePrefix: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4) });
  const bytes = (await res.arrayBuffer()).byteLength;
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) stop(res.status, "the link did not download");
  if (bytes === 0) stop(res.status, "the download is empty");
  if (!type.startsWith(typePrefix)) stop(res.status, `content type ${type || "missing"}`);
  return { status: res.status, note: `${bytes} bytes, ${type}` };
}

async function main() {
  const fixture = readFileSync(join(import.meta.dirname, "../tests/fixtures/media/speech-en.mp4"));
  const run: { takeId: string | null; completed: boolean } = { takeId: null, completed: false };

  await step("openapi: the document lists the routes this run uses", async () => {
    const res = await api("GET", "/api/openapi.json", undefined, false);
    const doc = z
      .object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) })
      .safeParse(res.json);
    if (res.status !== 200 || !doc.success) return stop(res.status, "no OpenAPI document");
    const paths = doc.data.paths;
    // Every route template this run calls, with the method it uses.
    const need: readonly (readonly [string, string])[] = [
      ["get", "/api/usage"],
      ["post", "/api/uploads"],
      ["delete", "/api/uploads/{takeId}"],
      ["post", "/api/uploads/{takeId}/parts"],
      ["post", "/api/uploads/{takeId}/complete"],
      ["get", "/api/takes/{id}"],
      ["delete", "/api/takes/{id}"],
      ["post", "/api/takes/{id}/changes"],
      ["get", "/api/takes/{id}/jobs/{jobId}"],
      ["get", "/api/takes/{id}/media"],
      ["get", "/api/takes/{id}/transcript"],
      ["get", "/api/takes/{id}/transcript/{format}"],
    ];
    const missing = need.filter(([method, path]) => !(path in paths && method in paths[path]));
    if (missing.length > 0) {
      return stop(res.status, `routes missing: ${missing.map(([m, p]) => `${m} ${p}`).join(", ")}`);
    }
    return {
      status: res.status,
      note: `${Object.keys(paths).length} paths, ${need.length} checked`,
    };
  });

  await step("usage: read the allowance", async () => {
    const reply = await api("GET", "/api/usage");
    const usage = shaped("Usage", reply);
    return {
      status: reply.status,
      note: `${usage.remainingSeconds} s left of ${usage.allowanceSeconds}`,
    };
  });

  await step("upload: start", async () => {
    const reply = await api("POST", "/api/uploads", {
      fileName: "api-real-run.mp4",
      sizeBytes: fixture.length,
      container: "mp4",
    });
    const created = shaped("UploadCreated", reply, 201);
    run.takeId = created.takeId;
    if (created.partCount !== Math.ceil(fixture.length / created.partSize)) {
      stop(reply.status, "the part count does not match the size");
    }
    return { status: reply.status, note: `take ${run.takeId}, ${created.partCount} part(s)` };
  });

  const parts: { partNumber: number; etag: string }[] = [];
  await step("upload: send the parts to storage", async () => {
    const detailed = await api("POST", `/api/uploads/${run.takeId}/parts`, { partNumbers: [1] });
    const plan = shaped("UploadPartLinks", detailed);
    const link = plan.parts[0];
    if (!link) return stop(detailed.status, "no link for part 1");
    const put = await fetch(link.url, {
      method: "PUT",
      body: fixture,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4),
    });
    const etag = put.headers.get("etag");
    if (!put.ok || etag === null) stop(put.status, "the part was not accepted by storage");
    parts.push({ partNumber: 1, etag: etag ?? "" });
    return { status: put.status, note: "1 part sent" };
  });

  await step("upload: complete", async () => {
    const reply = await api("POST", `/api/uploads/${run.takeId}/complete`, { parts });
    const done = shaped("UploadCompleted", reply);
    run.completed = true;
    return { status: reply.status, note: `status ${done.status}` };
  });

  let detail: Detail | null = null;
  await step("process: wait until the take is ready", async () => {
    let last = 200;
    const final = await pollUntil(
      async () => {
        const reply = await api("GET", `/api/takes/${run.takeId}`);
        last = reply.status;
        return shaped("TakeDetail", reply);
      },
      (d) => d.take.status === "ready" || d.take.status === "failed",
      waitSeconds,
    );
    if (final === null) return stop(last, `not ready after ${waitSeconds} s`);
    if (final.take.status !== "ready") {
      return stop(
        last,
        `the take ended ${final.take.status} (${final.take.failureCode ?? "no code"})`,
      );
    }
    detail = final;
    return {
      status: last,
      note: `ready, ${final.cuts.length} cut(s), ${final.removedMs} ms removed`,
    };
  });

  const applied = () => (detail?.cuts ?? []).find((c) => c.applied);
  // The cut chosen for undo and redo: picked once, so both steps and the checks use the same ID.
  let chosenCutId: string | null = null;
  await step("cuts: list them", async () => {
    const reply = await api("GET", `/api/takes/${run.takeId}`);
    const now = shaped("TakeDetail", reply);
    detail = now;
    if (now.cuts.length === 0) return stop(reply.status, "the clip has no cuts to undo");
    if (!applied()) return stop(reply.status, "no cut is applied to the video");
    return { status: reply.status, note: `${now.cuts.length} cut(s)` };
  });

  await step("cuts: undo one", async () => {
    const cut = applied();
    if (!cut || !run.takeId) return stop(0, "no cut to undo");
    chosenCutId = cut.id;
    const result = await changeCuts(run.takeId, [{ id: cut.id, applied: false }]);
    const after = result.detail.cuts.find((c) => c.id === cut.id);
    if (after?.applied !== false) return stop(200, "the cut is still applied after the undo");
    detail = result.detail;
    return {
      status: result.status,
      note: `cut ${cut.id} off, ${result.detail.removedMs} ms removed`,
    };
  });

  await step("cuts: redo it", async () => {
    const cut = (detail?.cuts ?? []).find((c) => c.id === chosenCutId);
    if (!cut || !run.takeId) return stop(0, "the cut chosen for the undo is gone");
    if (cut.applied) return stop(200, "the chosen cut is still applied, nothing to redo");
    const result = await changeCuts(run.takeId, [{ id: cut.id, applied: true }]);
    const after = result.detail.cuts.find((c) => c.id === cut.id);
    if (after?.applied !== true) return stop(200, "the cut is not applied after the redo");
    detail = result.detail;
    return {
      status: result.status,
      note: `cut ${cut.id} on, ${result.detail.removedMs} ms removed`,
    };
  });

  await step("video: the download link works", async () => {
    const reply = await api("GET", `/api/takes/${run.takeId}/media?kind=download`);
    const link = shaped("MediaLink", reply);
    const got = await checkDownload(link.url, "video/");
    return { status: got.status, note: got.note };
  });

  await step("transcript: the text file downloads", async () => {
    const view = await pollUntil(
      async () => shaped("TranscriptView", await api("GET", `/api/takes/${run.takeId}/transcript`)),
      (v) => v.state !== "making",
      120,
    );
    if (view?.state !== "ready") return stop(200, `transcript state ${view?.state ?? "making"}`);
    const text = await fetch(`${base}/api/takes/${run.takeId}/transcript/txt`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const type = text.headers.get("content-type") ?? "";
    const bytes = (await text.arrayBuffer()).byteLength;
    if (!text.ok || bytes === 0) return stop(text.status, "the transcript file is empty");
    if (!type.startsWith("text/")) return stop(text.status, `content type ${type || "missing"}`);
    return { status: text.status, note: `${bytes} bytes, ${type}` };
  });

  await step("delete: remove the take", async () => {
    const reply = await api("DELETE", `/api/takes/${run.takeId}`);
    if (reply.status !== 204) return stop(reply.status, `expected 204, got ${codeOf(reply)}`);
    const after = await api("GET", `/api/takes/${run.takeId}`);
    if (after.status !== 404) return stop(after.status, "the take is still there after the delete");
    run.takeId = null;
    return { status: reply.status, note: "deleted, a read now gives 404" };
  });

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

  if (!failed) {
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

main()
  .catch((error: unknown) => {
    // The message names a step and a status only; it never holds a link or the key.
    console.error(`api-real-run failed: ${errorKind(error)}`);
    failed = true;
  })
  .finally(() => {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${failed ? "FAILED" : "OK"}  ${passed} of ${results.length} steps passed`);
    if (failed) process.exitCode = 1;
  });
