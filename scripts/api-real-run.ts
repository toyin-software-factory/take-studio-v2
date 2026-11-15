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

import { finish } from "./api-real-run-tail";
import {
  base,
  waitSeconds,
  key,
  REQUEST_TIMEOUT_MS,
  stop,
  api,
  codeOf,
  shaped,
  results,
  state,
  step,
  errorKind,
  pollUntil,
  type Detail,
  changeCuts,
  checkDownload,
  type Run,
} from "./api-real-run-core";

async function main() {
  const fixture = readFileSync(join(import.meta.dirname, "../tests/fixtures/media/speech-en.mp4"));
  const run: Run = { takeId: null, completed: false };

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

  await finish(run);
}

main()
  .catch((error: unknown) => {
    // The message names a step and a status only; it never holds a link or the key.
    console.error(`api-real-run failed: ${errorKind(error)}`);
    state.failed = true;
  })
  .finally(() => {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${state.failed ? "FAILED" : "OK"}  ${passed} of ${results.length} steps passed`);
    if (state.failed) process.exitCode = 1;
  });
