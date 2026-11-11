/**
 * Scrubbing for every Sentry event and breadcrumb, on the web, in the browser and in jobs
 * (spec 0005, AC-4). Pure functions over plain objects, so they need no Sentry import and are
 * unit tested. They run in `beforeSend` and `beforeBreadcrumb`; Sentry's server side scrubbing
 * is only a backup.
 */
import { isFailureCode } from "./failure-codes";
import { JOB_KINDS } from "./processing";

export const REDACTED = "[redacted]";

/** `extra` keys allowed through. Only IDs: never titles, file names, emails or text. */
export const ALLOWED_EXTRA_KEYS: ReadonlySet<string> = new Set([
  "takeId",
  "jobId",
  "renderId",
  "cutId",
  "step",
  "attempt",
]);

/** Request headers allowed through (all others, including authorization and cookie, go). */
const ALLOWED_HEADERS: ReadonlySet<string> = new Set(["content-type"]);

/** Breadcrumb `data` keys allowed through (fetch, xhr and navigation breadcrumbs). */
const ALLOWED_BREADCRUMB_DATA: ReadonlySet<string> = new Set([
  "method",
  "url",
  "status_code",
  "from",
  "to",
]);

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>`]+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_URL_MARKERS = /x-amz-|r2\.cloudflarestorage\.com/i;
const MAX_DEPTH = 8;

type Json = unknown;
type Obj = Record<string, unknown>;

const isObject = (value: Json): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Removes the query string and fragment of a URL or path (`/a?b=1#c` becomes `/a`). */
export function stripQuery(url: string): string {
  return url.replace(/[?#][\s\S]*$/, "");
}

/**
 * In free text: presigned and R2 URLs become `[redacted]`, other URLs lose their query
 * string, and email addresses become `[redacted]`.
 */
export function redactText(text: string): string {
  return text
    .replace(URL_PATTERN, (url) => (SECRET_URL_MARKERS.test(url) ? REDACTED : stripQuery(url)))
    .replace(EMAIL_PATTERN, REDACTED);
}

/** Applies `redactText` to every string inside `value`, returning a new value. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return redactText(value) as T;
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1)) as T;
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]),
    ) as T;
  }
  return value;
}

const pick = (source: Obj, allowed: ReadonlySet<string>): Obj =>
  Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));

/** Request: URL without query, allowlisted headers only; no body, cookies or query string. */
function scrubRequest(request: Obj): Obj {
  const { url, method, headers } = request;
  return {
    ...(typeof url === "string" ? { url: redactText(stripQuery(url)) } : {}),
    ...(typeof method === "string" ? { method } : {}),
    ...(isObject(headers)
      ? {
          headers: Object.fromEntries(
            Object.entries(headers).filter(([name]) => ALLOWED_HEADERS.has(name.toLowerCase())),
          ),
        }
      : {}),
  };
}

/** A breadcrumb with URLs stripped or redacted and only allowlisted data keys. */
export function scrubBreadcrumb<B extends object>(input: B): B {
  const breadcrumb = input as Obj;
  const { data, message } = breadcrumb;
  const cleanData = isObject(data)
    ? Object.fromEntries(
        Object.entries(pick(data, ALLOWED_BREADCRUMB_DATA)).map(([key, value]) => [
          key,
          typeof value === "string" ? redactText(stripQuery(value)) : value,
        ]),
      )
    : undefined;
  return {
    ...breadcrumb,
    ...(typeof message === "string" ? { message: redactText(message) } : {}),
    ...(cleanData ? { data: cleanData } : {}),
  } as B;
}

/**
 * The whole event: request reduced, user reduced to `{ id }`, `extra` allowlisted, every
 * string (messages, exception values, tags, contexts) redacted, breadcrumbs scrubbed.
 */
export function scrubEvent<E extends object>(event: E): E {
  const { request, user, extra, breadcrumbs, ...rest } = event as Obj;
  const scrubbed: Obj = redactDeep(rest);

  if (isObject(request)) scrubbed.request = scrubRequest(request);
  if (isObject(user) && (typeof user.id === "string" || typeof user.id === "number")) {
    scrubbed.user = { id: String(user.id) };
  }
  if (isObject(extra)) scrubbed.extra = redactDeep(pick(extra, ALLOWED_EXTRA_KEYS));
  if (Array.isArray(breadcrumbs)) {
    scrubbed.breadcrumbs = breadcrumbs.map((crumb) =>
      isObject(crumb) ? scrubBreadcrumb(crumb) : crumb,
    );
  }
  return scrubbed as E;
}

/** IDs a job failure may carry as tags (spec 0005, AC-3). */
export const JOB_TAG_KEYS = ["takeId", "jobId", "renderId"] as const;

type JobTags = Partial<
  Record<(typeof JOB_TAG_KEYS)[number] | "kind" | "failureCode" | "statusCode", string>
>;

/**
 * The allowlisted tags from a task payload: the IDs `takeId`, `jobId` and `renderId` (only when
 * they are short ID strings), plus, from spec 0007, the job `kind` (only a known kind such as
 * `transcribe`), a `failureCode` (only a code in the registry, such as `provider_rejected`) and
 * a provider `statusCode` (only three digits). Anything else, and the payload itself, is never
 * sent: a transcript text, a title or a file key can't ride along.
 */
export function jobTagsFrom(payload: unknown): JobTags {
  if (!isObject(payload)) return {};
  const ids = Object.fromEntries(
    JOB_TAG_KEYS.flatMap((key) => {
      const value = payload[key];
      return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? [[key, value]] : [];
    }),
  );
  const { kind, failureCode, statusCode } = payload;
  return {
    ...ids,
    ...(typeof kind === "string" && (JOB_KINDS as readonly string[]).includes(kind)
      ? { kind }
      : {}),
    ...(typeof failureCode === "string" && isFailureCode(failureCode) ? { failureCode } : {}),
    ...(typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    /^\d{3}$/.test(String(statusCode))
      ? { statusCode: String(statusCode) }
      : {}),
  };
}
