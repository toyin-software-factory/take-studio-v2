import { reserveMint } from "@/db/data/realtime-mints";
import type { Db } from "@/db/types";
import {
  DEEPGRAM_GRANT_URL,
  REALTIME_TOKEN,
  type RealtimeToken,
  grantRequestBody,
  grantResponseSchema,
} from "@/lib/realtime-rules";
import { shortDate } from "@/lib/usage-rules";
import { PRIVATE_NO_STORE, usageForCreator, usageNumbers } from "../usage";

/**
 * `POST /api/realtime/token` (spec 0021 step 2, AC-12): a short lived Deepgram token for the
 * browser, so voice following can stream the microphone without the browser ever holding our key.
 * Order: Origin, any `Authorization` header (a bearer key may not mint), session, the separate
 * Deepgram key, the usage check, the rate and daily caps, then the grant. The token is a secret:
 * it exists only in the 200 body and is never logged. The route logs a status code, never a body.
 */

export type Creator = { readonly db: Db; readonly creatorId: string };

export type RealtimeHttpDeps = {
  readonly getCreator: (request: Request) => Promise<Creator | null>;
  /** The only origin allowed to mint (the app's own). */
  readonly allowedOrigin: string;
  /** The separate capped Deepgram key, or null when it is not set. Never the transcription key. */
  readonly deepgramKey: () => string | null;
  /** USAGE_HASH_SECRET, or null when it is not set (the usage check is then skipped). */
  readonly usageSecret?: () => string | null;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** Logs a line with codes only. */
  readonly log?: (message: string, fields: Readonly<Record<string, string | number>>) => void;
};

export type RealtimeError =
  | "forbidden"
  | "unauthorized"
  | "session_required"
  | "limit_exceeded"
  | "rate_limited"
  | "unavailable";

const STATUS: Readonly<Record<RealtimeError, number>> = {
  forbidden: 403,
  unauthorized: 401,
  session_required: 401,
  limit_exceeded: 403,
  rate_limited: 429,
  unavailable: 503,
};

const MESSAGES: Readonly<Record<Exclude<RealtimeError, "limit_exceeded">, string>> = {
  forbidden: "This request isn't allowed.",
  unauthorized: "Please sign in again.",
  session_required: "Follow my voice works from your signed in account, not with an API key.",
  rate_limited:
    "Follow my voice has been started a lot lately. Your script will scroll on a timer.",
  unavailable: "Follow my voice isn't available right now. Your script will scroll on a timer.",
};

const reply = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { ...PRIVATE_NO_STORE, ...headers } });

const refuse = (code: Exclude<RealtimeError, "limit_exceeded">, headers = {}): Response =>
  reply({ error: code, message: MESSAGES[code] }, STATUS[code], headers);

/** Asks Deepgram for the token. A failure is a status code or a name, never a body. */
async function grant(
  key: string,
  deps: RealtimeHttpDeps,
): Promise<RealtimeToken | { readonly failure: string }> {
  try {
    const response = await (deps.fetch ?? fetch)(DEEPGRAM_GRANT_URL, {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/json" },
      body: JSON.stringify(grantRequestBody()),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { failure: `status_${response.status}` };
    const parsed = grantResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { failure: "bad_answer" };
    return {
      token: parsed.data.access_token,
      expiresInSeconds: Math.floor(parsed.data.expires_in),
    };
  } catch (error) {
    return { failure: error instanceof Error ? error.name : "unknown" };
  }
}

/** The usage refusal, or null. A missing secret lets the mint go on; a failed read refuses it. */
async function usageRefusal(creator: Creator, deps: RealtimeHttpDeps, now: Date) {
  const secret = deps.usageSecret?.() ?? null;
  if (!secret) return null;
  try {
    const usage = await usageForCreator(creator.db, {
      creatorId: creator.creatorId,
      usageSecret: secret,
      now,
    });
    if (!usage.ok) return refuse("unavailable");
    if (!usage.data.enforced || usage.data.remainingSeconds > 0) return null;
    return reply(
      {
        error: "limit_exceeded",
        message: `This month's allowance is used up. Your minutes come back on ${shortDate(usage.data.resetsOn)}.`,
        ...usageNumbers(usage.data),
      },
      STATUS.limit_exceeded,
    );
  } catch {
    return refuse("unavailable");
  }
}

export async function handleToken(request: Request, deps: RealtimeHttpDeps): Promise<Response> {
  if (request.headers.get("origin") !== deps.allowedOrigin) return refuse("forbidden");
  if (request.headers.has("authorization")) return refuse("session_required");
  const creator = await deps.getCreator(request);
  if (!creator) return refuse("unauthorized");
  const key = deps.deepgramKey();
  if (!key) return refuse("unavailable");
  const now = deps.now?.() ?? new Date();
  const limited = await usageRefusal(creator, deps, now);
  if (limited) return limited;
  const slot = await reserveMint(creator.db, { creatorId: creator.creatorId, now });
  if (!slot.ok) {
    if (slot.error === "not_found") return refuse("unauthorized");
    const retryAfter = slot.error === "hourly" ? REALTIME_TOKEN.hourMs : REALTIME_TOKEN.dayMs;
    return refuse("rate_limited", { "retry-after": String(Math.ceil(retryAfter / 1000)) });
  }
  const minted = await grant(key, deps);
  if ("failure" in minted) {
    (deps.log ?? (() => undefined))("realtime token grant failed", { reason: minted.failure });
    return refuse("unavailable");
  }
  return reply({ token: minted.token, expiresInSeconds: minted.expiresInSeconds }, 200);
}
