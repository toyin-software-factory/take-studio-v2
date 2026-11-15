export const ORIGIN = "https://take-studio.example";
export const SECRET = "x".repeat(40);
export const NOT_FOUND = { error: "not_found", message: "We couldn't find that take." };
export type Signed = { key: string; expiresSeconds: number; type: string; fileName: string };
export function req(
  method: string,
  path: string,
  body?: unknown,
  origin: string | null = ORIGIN,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
