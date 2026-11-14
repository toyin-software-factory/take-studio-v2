/**
 * Upload, run, review, fetch and delete through /mcp only (spec 0019 AC-5, AC-6), on a synthetic
 * test take this script makes with ffmpeg (a test pattern and a tone, never a creator's video).
 *
 * Usage:
 *   MCP_API_KEY=tsk_… pnpm tsx scripts/mcp-check.ts --base http://localhost:3000
 *
 * The key is read from the environment and never printed. Part links are secrets: they are used
 * and dropped, never logged. Only IDs, statuses and counts are printed. The take is always
 * deleted at the end (delete_take with confirm), whatever happened. A non local --base needs
 * --allow-remote (the live run goes through the lead, with a production key).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const base = arg("base", "http://localhost:3000").replace(/\/$/, "");
const waitSeconds = Number(arg("wait", "900"));
const key = z
  .string()
  .regex(/^tsk_/, "Set MCP_API_KEY to an API key (tsk_…).")
  .parse(process.env.MCP_API_KEY);
const local = ["localhost", "127.0.0.1"].includes(new URL(base).hostname);
if (!local && !args.includes("--allow-remote")) {
  throw new Error("--base is not localhost. Pass --allow-remote to run against another server.");
}
if (!local && new URL(base).protocol !== "https:") {
  throw new Error("--base must use https:// unless it is localhost (the key is sent as a header).");
}

const log = (step: string, detail: unknown = "") =>
  console.log(
    `${new Date().toISOString().slice(11, 19)} ${step} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
  );
const fail = (message: string): never => {
  throw new Error(message);
};

let nextId = 1;
/** One JSON-RPC call to /mcp. The answer is JSON or one server sent event. */
async function rpc(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!res.ok) fail(`${method}: HTTP ${res.status}`);
  const raw = await res.text();
  const data = raw.startsWith("{")
    ? raw
    : (raw.split("\n").find((l) => l.startsWith("data:")) ?? "");
  const body = JSON.parse(data.replace(/^data:\s*/, "")) as { result?: unknown; error?: unknown };
  if (body.error !== undefined) fail(`${method}: rpc error`);
  return body.result;
}

const toolResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});
/** Calls a tool and returns its parsed JSON answer; a tool error returns the route's own body. */
async function tool(name: string, input: Record<string, unknown>) {
  const result = toolResult.parse(await rpc("tools/call", { name, arguments: input }));
  const text = result.content.map((c) => c.text ?? "").join("");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A plain text answer has no fields to read.
  }
  return { isError: result.isError === true, body };
}

/** A 6 second 640x360 test pattern with a tone, made by ffmpeg in a temp folder. */
function makeFixture(dir: string): string {
  const file = join(dir, "fixture.mp4");
  execFileSync(
    "ffmpeg",
    [
      ...["-v", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:duration=6"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file],
    ],
    { stdio: "inherit" },
  );
  return file;
}

const planSchema = z.object({
  takeId: z.uuid(),
  partSize: z.number().int().positive(),
  partCount: z.number().int().positive(),
  parts: z.array(z.object({ partNumber: z.number().int(), url: z.string() })),
  libraryUrl: z.string(),
  steps: z.string(),
});

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-check-"));
  let takeId: string | null = null;
  try {
    await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcp-check", version: "1" },
    });
    const listed = z
      .object({ tools: z.array(z.object({ name: z.string() })) })
      .parse(await rpc("tools/list", {}));
    log("tools", { count: listed.tools.length });

    const file = makeFixture(dir);
    const bytes = readFileSync(file);
    const started = await tool("start_upload", {
      fileName: "fixture.mp4",
      sizeBytes: bytes.length,
      container: "mp4",
    });
    if (started.isError) fail(`start_upload refused: ${String(started.body.error)}`);
    // Record the take first, so cleanup deletes it even if the rest of the answer is unusable.
    const created = z.object({ takeId: z.string().min(1) }).safeParse(started.body);
    if (created.success) takeId = created.data.takeId;
    const plan = planSchema.parse(started.body);
    log("start_upload", { takeId, partCount: plan.partCount, links: plan.parts.length });
    if (plan.parts.length !== plan.partCount) fail("expected links for every part of a small file");

    const etags: { partNumber: number; etag: string }[] = [];
    for (const part of plan.parts) {
      const from = (part.partNumber - 1) * plan.partSize;
      const put = await fetch(part.url, {
        method: "PUT",
        body: bytes.subarray(from, from + plan.partSize),
      });
      const etag = put.headers.get("etag");
      if (!put.ok || etag === null) fail(`part ${part.partNumber}: PUT status ${put.status}`);
      etags.push({ partNumber: part.partNumber, etag: etag ?? "" });
    }
    log("parts sent", { count: etags.length });

    const completed = await tool("complete_upload", { takeId, parts: etags });
    if (completed.isError) fail(`complete_upload refused: ${String(completed.body.error)}`);
    log("complete_upload", { status: completed.body.status });

    const deadline = Date.now() + waitSeconds * 1000;
    let status = "";
    let detail: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      const got = await tool("get_take", { takeId });
      if (got.isError) fail(`get_take refused: ${String(got.body.error)}`);
      const take = (got.body.take ?? {}) as { status?: string };
      detail = got.body;
      if (take.status !== status) log("get_take", { status: take.status });
      status = take.status ?? "";
      if (status === "ready" || status === "failed") break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (status !== "ready") fail(`the take did not become ready (last status ${status || "none"})`);

    const cuts = Array.isArray(detail.cuts) ? detail.cuts.length : 0;
    log("review", { cuts });
    const media = await tool("get_media_link", { takeId, kind: "download" });
    if (media.isError) fail("get_media_link refused");
    log("get_media_link", { hasUrl: typeof media.body.url === "string" });
    const transcript = await tool("get_transcript", { takeId });
    if (transcript.isError) fail("get_transcript refused");
    log("get_transcript", { state: transcript.body.status ?? transcript.body.state ?? "?" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (takeId !== null) {
      const gone = await tool("delete_take", { takeId, confirm: true });
      const after = await tool("get_take", { takeId });
      log("delete_take", { deleted: !gone.isError, getAfter: after.isError ? "refused" : "found" });
      if (gone.isError || !after.isError) process.exitCode = 1;
    }
  }
}

main().then(
  () => log("done", process.exitCode ? "FAILED to delete" : "ok"),
  (error: unknown) => {
    // The message names a step and a status only; it never holds a link or the key.
    console.error(`mcp-check failed: ${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  },
);
