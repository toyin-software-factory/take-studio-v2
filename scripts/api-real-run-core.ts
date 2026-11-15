/** Setup, the request helper and the step runner of the API real run (moved out of api-real-run.ts). */
import { z } from "zod";
import { RESPONSE_SCHEMAS } from "../src/lib/api-schemas/responses";

export const args = process.argv.slice(2);
/** The operand of `--name`, or undefined when the flag is absent. A flag with no operand is an error. */
export const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value.`);
  return value;
};
export const seconds = (name: string, fallback: number): number => {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} is a whole number of seconds, 0 or more.`);
  return Number(raw);
};
export const base = (flag("base") ?? process.env.API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
export const waitSeconds = seconds("wait", 600);
export const revokeSeconds = seconds("revoke-wait", 300);
export const key = z
  .string()
  .regex(/^tsk_[A-Za-z0-9_-]{43}$/, "Set TAKE_API_KEY to an API key (tsk_…).")
  .parse(process.env.TAKE_API_KEY);
export const local = ["localhost", "127.0.0.1"].includes(new URL(base).hostname);
if (!local && !args.includes("--allow-remote")) {
  throw new Error("The base URL is not localhost. Pass --allow-remote to run against it.");
}
if (!local && new URL(base).protocol !== "https:") {
  throw new Error("The base URL must use https:// unless it is localhost (the key is a header).");
}
if (![waitSeconds, revokeSeconds].every((n) => Number.isFinite(n) && n >= 0)) {
  throw new Error("--wait and --revoke-wait are seconds, 0 or more.");
}

export const REQUEST_TIMEOUT_MS = 30_000;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A step failed: the HTTP status (0 when there was none) and a reason with no secret in it. */
export class StepFailed extends Error {
  constructor(
    readonly status: number,
    reason: string,
  ) {
    super(reason);
  }
}
export const stop = (status: number, reason: string): never => {
  throw new StepFailed(status, reason);
};

export type Reply = { status: number; json: unknown; headers: Headers };

/** One API call with the key. The body is read as JSON when it is JSON, else left null. */
export async function api(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<Reply> {
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
export function codeOf(reply: Reply): string {
  const parsed = z.object({ error: z.string().regex(/^[a-z_]{1,40}$/) }).safeParse(reply.json);
  return parsed.success ? parsed.data.error : "no error code";
}

/** The body as the documented response schema says, or a failed step. */
export function shaped<N extends keyof typeof RESPONSE_SCHEMAS>(
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

export const results: { name: string; ok: boolean }[] = [];
export const state = { failed: false };

/** Runs one step. After a failure the later steps do not run (they would only repeat it). */
export async function step(name: string, run: () => Promise<{ status: number; note: string }>) {
  if (state.failed) return;
  try {
    const { status, note } = await run();
    console.log(`PASS  ${name}  HTTP ${status}  ${note}`);
    results.push({ name, ok: true });
  } catch (error) {
    state.failed = true;
    results.push({ name, ok: false });
    const status = error instanceof StepFailed ? error.status : 0;
    // Only our own reasons are printed; an unknown error is named by its kind, never its text.
    const reason = error instanceof StepFailed ? error.message : `${errorKind(error)}`;
    console.log(`FAIL  ${name}  HTTP ${status || "none"}  ${reason}`);
  }
}

export function errorKind(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "the request timed out";
  return "the request did not complete";
}

export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  seconds: number,
) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) return null;
    await sleep(3_000);
  }
}

export type Detail = z.infer<typeof RESPONSE_SCHEMAS.TakeDetail>;
export const readTake = async (id: string): Promise<Detail> =>
  shaped("TakeDetail", await api("GET", `/api/takes/${id}`));

/** Starts a render with these cut choices and waits for its job; returns the take after it. */
export async function changeCuts(
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
export async function checkDownload(url: string, typePrefix: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4) });
  const bytes = (await res.arrayBuffer()).byteLength;
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) stop(res.status, "the link did not download");
  if (bytes === 0) stop(res.status, "the download is empty");
  if (!type.startsWith(typePrefix)) stop(res.status, `content type ${type || "missing"}`);
  return { status: res.status, note: `${bytes} bytes, ${type}` };
}

export type Run = { takeId: string | null; completed: boolean };
