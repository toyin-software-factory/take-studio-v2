import {
  authenticateApiKey,
  countApiRequest,
  bearerFailuresNow,
  countBearerFailure,
} from "@/db/data/api-keys";
import type { Db } from "@/db/types";
import {
  bearerKey,
  clientIpOf,
  hashApiKey,
  hashClientIp,
  failureWentOver,
  isOverFailLimit,
  isOverRateLimit,
  retryAfterFromSecond,
  retryAfterSeconds,
} from "@/lib/api-rules";
import { authenticateOauthToken, countOauthRequest } from "@/db/data/oauth";
import { bearerToken, hashOauthToken } from "@/lib/oauth-rules";
import { ok } from "@/lib/result";

/**
 * The one identity entry point (spec 0018 AC-5, AC-6, AC-9, AC-10, AC-16). A request with an
 * `Authorization` header (any value, even empty) is judged by the key alone: a valid key gives
 * the creator, anything else is 401 `invalid_api_key`, and the session cookie is never read as
 * a fallback. A request without the header is judged by the session, as before. Both end in the
 * same `Creator` the handlers take. `guard` is the only place the 401, 403 and 429 bodies and
 * `Retry-After` are made. Nothing here logs a key, its hash or its prefix; a rejection writes one
 * `api_key_rejected` line with a reason code only.
 */

export type Creator = { readonly db: Db; readonly creatorId: string };

export type ApiAuthDeps = {
  /** The signed in creator from the cookie session, or null. Never called beside a header. */
  readonly getCreator: (request: Request) => Promise<Creator | null>;
  /** The only origin allowed to make a session request that changes something. */
  readonly allowedOrigin?: string;
  /** Left out, a request with an `Authorization` header is always `invalid_api_key`. */
  readonly keyAuth?: {
    readonly getDb: () => Promise<Db>;
    /**
     * The resource OAuth access tokens must be issued for (`<base>/mcp`, spec 0019 AC-13). Left
     * out, a bearer value that is not an API key is `invalid_api_key`.
     */
    readonly oauthResource?: string;
    /** Tests only: the clock of the rate window. Left out, the database clock decides. */
    readonly now?: () => Date;
  };
};

export type ApiAuthError =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "invalid_api_key" }
  | { readonly kind: "rate_limited"; readonly retryAfter: number };

type AuthFailure = ApiAuthError["kind"];
type Resolved =
  | { readonly ok: true; readonly data: Creator }
  | { readonly ok: false; readonly error: ApiAuthError };
const fail = (error: ApiAuthError) => ({ ok: false, error }) as const;

function logRejected(reason: "malformed" | "unknown" | "unavailable"): void {
  console.warn("api_key_rejected", { reason });
}

/**
 * B2-T103: the per address limit on wrong bearer values. Before any key or token lookup the
 * committed failures of this address are read (a plain read); at the limit the request is a 429
 * and no lookup happens. A wrong value is counted afterwards with one atomic upsert that returns
 * the new count, so parallel failures each get their own number and one that lands past the
 * limit answers 429 too. A good request never touches the counter, so valid traffic alone can
 * never trip the limit. Deliberate trade: requests already past the read when the limit is
 * reached still do their lookup, so a burst can overshoot by at most what one address has in
 * flight at once (their failures still count and answer 429).
 * The address is only ever used as a hash. With no address (local runs) nothing is limited. A
 * limit that cannot be read or written never blocks a request.
 */
async function failureGate(
  keyAuth: NonNullable<ApiAuthDeps["keyAuth"]>,
  ip: string | null,
): Promise<{
  readonly blocked: ApiAuthError | null;
  readonly countFailure: () => Promise<ApiAuthError | null>;
}> {
  const none = { blocked: null, countFailure: async () => null };
  if (ip === null) return none;
  const ipHash = await hashClientIp(ip);
  const at = keyAuth.now?.();
  const limited = (secondsIntoMinute: number): ApiAuthError => ({
    kind: "rate_limited",
    retryAfter: at ? retryAfterSeconds(at) : retryAfterFromSecond(secondsIntoMinute),
  });
  try {
    const db = await keyAuth.getDb();
    const { failures, secondsIntoMinute } = await bearerFailuresNow(db, ipHash, at);
    if (isOverFailLimit(failures)) {
      console.warn("api_bearer_ip_limited");
      return { blocked: limited(secondsIntoMinute), countFailure: async () => null };
    }
    return {
      blocked: null,
      countFailure: async () => {
        try {
          const counted = await countBearerFailure(db, ipHash, at);
          return failureWentOver(counted.count) ? limited(counted.secondsIntoMinute) : null;
        } catch {
          return null;
        }
      },
    };
  } catch {
    return none;
  }
}

async function resolveKey(
  header: string,
  keyAuth: NonNullable<ApiAuthDeps["keyAuth"]>,
  ip: string | null,
): Promise<Resolved> {
  const gate = await failureGate(keyAuth, ip);
  if (gate.blocked) return fail(gate.blocked);
  return lookupBearer(header, keyAuth, async (reason) => {
    logRejected(reason);
    const over = await gate.countFailure();
    return fail(over ?? { kind: "invalid_api_key" });
  });
}

async function lookupBearer(
  header: string,
  keyAuth: NonNullable<ApiAuthDeps["keyAuth"]>,
  onRejected: (reason: "malformed" | "unknown") => Promise<Resolved>,
): Promise<Resolved> {
  const rejected = onRejected;
  const key = bearerKey(header);
  const token = key === null && keyAuth.oauthResource ? bearerToken(header) : null;
  if (token !== null && keyAuth.oauthResource) {
    // Spec 0019 AC-14: an OAuth access token reaches the same routes as the session, found by
    // its hash. Unknown, expired, revoked and wrong resource tokens are all one 401.
    const db = await keyAuth.getDb();
    const found = await authenticateOauthToken(
      db,
      await hashOauthToken(token),
      keyAuth.oauthResource,
      keyAuth.now?.(),
    );
    if (!found) return await rejected("unknown");
    // The same per minute limit as a key, counted for this app and creator.
    const at = keyAuth.now?.();
    const window = await countOauthRequest(db, found.clientId, found.creatorId, at);
    if (isOverRateLimit(window.count)) {
      return fail({
        kind: "rate_limited",
        retryAfter: at ? retryAfterSeconds(at) : retryAfterFromSecond(window.secondsIntoMinute),
      });
    }
    return ok({ db, creatorId: found.creatorId });
  }
  if (key === null) return await rejected("malformed");
  const db = await keyAuth.getDb();
  const found = await authenticateApiKey(db, await hashApiKey(key));
  if (!found) return await rejected("unknown");
  const at = keyAuth.now?.();
  const window = await countApiRequest(db, found.keyId, at);
  if (isOverRateLimit(window.count)) {
    return fail({
      kind: "rate_limited",
      retryAfter: at ? retryAfterSeconds(at) : retryAfterFromSecond(window.secondsIntoMinute),
    });
  }
  return ok({ db, creatorId: found.creatorId });
}

/** Header present: the key alone. Header absent: the session. No fallback either way. */
export async function resolveCreator(
  request: Request,
  deps: Pick<ApiAuthDeps, "getCreator" | "keyAuth">,
): Promise<Resolved> {
  const header = request.headers.get("authorization");
  if (header !== null) {
    if (!deps.keyAuth) {
      logRejected("unavailable");
      return fail({ kind: "invalid_api_key" });
    }
    return resolveKey(header, deps.keyAuth, clientIpOf(request.headers));
  }
  const creator = await deps.getCreator(request);
  return creator ? ok(creator) : fail({ kind: "unauthorized" });
}

const MESSAGES: Readonly<Record<AuthFailure | "forbidden" | "session_required", string>> = {
  unauthorized: "Please sign in again.",
  invalid_api_key: "That API key isn't valid. Check it, or make a new one.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  forbidden: "This request isn't allowed.",
  session_required: "This is only available when you're signed in, not with an API key.",
};

const STATUS = {
  unauthorized: 401,
  invalid_api_key: 401,
  session_required: 401,
  forbidden: 403,
  rate_limited: 429,
} as const;

function reply(
  code: keyof typeof STATUS,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    { error: code, message: MESSAGES[code] },
    { status: STATUS[code], headers: { "cache-control": "private, no-store", ...headers } },
  );
}

/**
 * The shared guard (AC-6). Header present: key path only, no Origin check. Header absent: Origin
 * on writes, then the session. `sessionOnly` routes (key management) refuse any header with
 * 401 `session_required`, after Origin. Returns the creator, or the Response to send.
 */
export async function guard(
  request: Request,
  deps: ApiAuthDeps,
  options: { readonly checkOrigin: boolean; readonly sessionOnly?: boolean },
): Promise<Creator | Response> {
  const hasHeader = request.headers.has("authorization");
  if (options.sessionOnly) {
    if (options.checkOrigin && request.headers.get("origin") !== deps.allowedOrigin) {
      return reply("forbidden");
    }
    if (hasHeader) return reply("session_required");
  } else if (
    !hasHeader &&
    options.checkOrigin &&
    request.headers.get("origin") !== deps.allowedOrigin
  ) {
    return reply("forbidden");
  }
  const resolved = await resolveCreator(request, deps);
  if (resolved.ok) return resolved.data;
  const { error } = resolved;
  return error.kind === "rate_limited"
    ? reply("rate_limited", { "retry-after": String(error.retryAfter) })
    : reply(error.kind);
}
