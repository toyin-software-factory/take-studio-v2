/**
 * Spec 0018 step 4 (AC-7): every route of the registry gives the same answer by session and by
 * key, a key never reaches another creator's data, and the monthly allowance applies by key
 * exactly as by session. Real handlers, real test database. Own database: `app_setting` is global.
 */
export const ORIGIN = "https://take-studio.example";
export const SECRET = "x".repeat(40);
export const NOW = new Date("2026-11-10T12:00:00Z");
export type Via = "session" | "key";
export type Caller = { readonly via: Via; readonly creatorId: string; readonly headers: Headers };
export type Ctx = { readonly c: Caller; readonly takeId: string };
export type Route = {
  readonly name: string;
  readonly takeScoped: boolean;
  readonly run: (ctx: Ctx) => Promise<Response>;
};
export const req = (c: Caller, path: string, method = "GET", body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: c.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
/** Drops what legitimately differs between two runs: ids, timestamps and presigned links. */
export function normalize(value: unknown, ids: readonly string[]): unknown {
  const text = JSON.stringify(value, (k, v) =>
    /(^|[a-z])(At|Url)$|^(id|jobId|takeId)$/.test(k) ? "<x>" : v,
  );
  return JSON.parse(ids.reduce((s, id) => s.split(id).join("<id>"), text));
}
export async function answer(res: Response, ids: readonly string[]) {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // A text body (a transcript file) is compared as text.
  }
  return {
    status: res.status,
    cache: res.headers.get("cache-control"),
    body: normalize(body, ids),
  };
}
