import { z } from "zod";

/**
 * Pure parts of the temporary `ai-key-check` task (B-T17, C-15): the payload, the header
 * allowlist, the error type, the key fingerprint and the result shape. Nothing here can carry the
 * key, the prompt or the answer text: the result is built only from the fields below.
 * Removed together with the task once C-15 is done.
 */

export const aiKeyCheckPayloadSchema = z.object({ token: z.string().min(1) });

/** The only response headers that may leave the task: the request ID, retry-after, rate limits. */
const ALLOWED_HEADER = /^(request-id|retry-after|anthropic-ratelimit-[a-z0-9-]+)$/;

/** At most this many characters of a header value are kept (a number or a timestamp). */
const MAX_VALUE = 120;

type HeaderSource =
  | { readonly forEach: (callback: (value: string, key: string) => void) => void }
  | Readonly<Record<string, unknown>>
  | null
  | undefined;

/** Picks only the allowed headers (names lower cased, values cut), in name order. */
export function pickHeaders(headers: HeaderSource): Readonly<Record<string, string>> {
  const picked: Record<string, string> = {};
  const add = (name: string, value: unknown) => {
    const key = name.toLowerCase();
    if (ALLOWED_HEADER.test(key) && typeof value === "string") {
      picked[key] = value.slice(0, MAX_VALUE);
    }
  };
  if (headers && typeof (headers as { forEach?: unknown }).forEach === "function") {
    (headers as { forEach: (cb: (value: string, key: string) => void) => void }).forEach(
      (value, key) => add(key, value),
    );
  } else if (headers) {
    for (const [name, value] of Object.entries(headers)) add(name, value);
  }
  return Object.fromEntries(Object.entries(picked).sort(([a], [b]) => a.localeCompare(b)));
}

/** The error type of an Anthropic error body (`{ error: { type } }`), or `unknown`. Never text. */
export function errorTypeFrom(body: unknown): string {
  const type = (body as { error?: { type?: unknown } } | null | undefined)?.error?.type;
  return typeof type === "string" && /^[a-z_]{1,64}$/.test(type) ? type : "unknown";
}

/** The first 8 hex characters of the key's SHA 256, and its length: enough to compare two keys. */
export async function keyFingerprint(
  key: string,
): Promise<{ readonly sha8: string; readonly length: number }> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return { sha8: hex.slice(0, 8), length: key.length };
}

/** What the one request came back with, already stripped: no body text, no key. */
export type RawOutcome = {
  readonly status: number | null;
  readonly headers: HeaderSource;
  /** Null when the request succeeded. */
  readonly errorType: string | null;
};

export type AiKeyCheckResult =
  | { readonly outcome: "skipped" }
  | { readonly outcome: "no_key" }
  | {
      readonly outcome: "checked";
      readonly status: number | null;
      readonly requestId: string | null;
      readonly retryAfter: string | null;
      /** Every `anthropic-ratelimit-*` header, by name. */
      readonly rateLimit: Readonly<Record<string, string>>;
      readonly errorType: string | null;
      readonly keySha8: string;
      readonly keyLength: number;
    };

/** Builds the `checked` result from the raw outcome and the key's fingerprint. */
export function buildCheckedResult(
  raw: RawOutcome,
  fingerprint: { readonly sha8: string; readonly length: number },
): Extract<AiKeyCheckResult, { outcome: "checked" }> {
  const headers = pickHeaders(raw.headers);
  const rateLimit = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.startsWith("anthropic-ratelimit-")),
  );
  return {
    outcome: "checked",
    status: raw.status,
    requestId: headers["request-id"] ?? null,
    retryAfter: headers["retry-after"] ?? null,
    rateLimit,
    errorType: raw.errorType,
    keySha8: fingerprint.sha8,
    keyLength: fingerprint.length,
  };
}
