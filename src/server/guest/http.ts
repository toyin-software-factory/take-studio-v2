import { turnstileEnvSchema } from "@/lib/env";
import { hashGuestIp } from "@/lib/guest-hash";
import { uploadGuestCreateSchema } from "@/lib/api-schemas/requests";
import { GUEST_MAX_BYTES } from "@/lib/guest-rules";
import { clientIpOf } from "@/lib/api-rules";
import type { UploadDeps } from "../uploads/base";
import { type GuestCreateError, createGuestUpload } from "./create";
import { guestCookieValue, guestSetCookie } from "./session";
import { type TurnstileError, verifyTurnstile } from "./turnstile";

/**
 * `POST /api/guest/uploads` (spec 0023). No sign in: the visitor passes the bot check and the
 * Origin check instead. Order: Origin, body, size, bot check, then the transaction. Fails closed:
 * with no Turnstile secret, no address header or no hash secret, the answer is a friendly refusal.
 */

export type GuestHttpDeps = {
  readonly appOrigin: string;
  /** Cookie `Secure` flag: true when the app runs on https. */
  readonly secureCookie: boolean;
  readonly uploadDeps: () => Promise<UploadDeps>;
  readonly hashSecret: () => string;
  /** The process env, read with `safeParse` for the Turnstile keys. */
  readonly env: Record<string, string | undefined>;
  readonly verify?: typeof verifyTurnstile;
};

const MESSAGES = {
  forbidden: "This request isn't allowed.",
  invalid: "That file can't be uploaded. Choose an MP4 or MOV video.",
  too_large: "This video is over 500 MB. Sign in to upload larger files.",
  bot_check_failed: "We couldn't confirm you're a person. Please try again.",
  guest_unavailable: "Uploading without an account isn't available right now. Sign in to upload.",
  storage_error: "Storage is having a problem right now. Please try again.",
} as const;

const STATUS = {
  forbidden: 403,
  invalid: 422,
  too_large: 422,
  bot_check_failed: 403,
  guest_unavailable: 503,
  storage_error: 503,
} as const;

function refuse(code: keyof typeof MESSAGES, cookie?: string): Response {
  const headers = new Headers({ "cache-control": "private, no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return Response.json({ error: code, message: MESSAGES[code] }, { status: STATUS[code], headers });
}

const fromCreate: Readonly<Record<GuestCreateError, keyof typeof MESSAGES>> = {
  invalid: "invalid",
  too_large: "too_large",
  storage_error: "storage_error",
};

const fromBotCheck: Readonly<Record<TurnstileError, keyof typeof MESSAGES>> = {
  failed: "bot_check_failed",
  unavailable: "guest_unavailable",
};

export async function handleGuestCreate(request: Request, deps: GuestHttpDeps): Promise<Response> {
  if (request.headers.get("origin") !== deps.appOrigin) return refuse("forbidden");
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = uploadGuestCreateSchema.safeParse(body);
  if (!parsed.success) return refuse("invalid");
  if (parsed.data.sizeBytes > GUEST_MAX_BYTES) return refuse("too_large");

  const keys = turnstileEnvSchema.safeParse(deps.env);
  const ip = clientIpOf(request.headers);
  if (!keys.success || !ip) return refuse("guest_unavailable");

  const checked = await (deps.verify ?? verifyTurnstile)({
    secret: keys.data.TURNSTILE_SECRET_KEY,
    token: parsed.data.turnstileToken,
    ip,
  });
  if (!checked.ok) return refuse(fromBotCheck[checked.error]);

  let ipHash: string;
  try {
    ipHash = await hashGuestIp(ip, deps.hashSecret());
  } catch {
    return refuse("guest_unavailable");
  }
  const result = await createGuestUpload(await deps.uploadDeps(), {
    body,
    cookie: guestCookieValue(request.headers.get("cookie")),
    ipHash,
  });
  if (!result.ok) return refuse(fromCreate[result.error]);
  const { token, ...upload } = result.data;
  return Response.json(upload, {
    status: 201,
    headers: {
      "cache-control": "private, no-store",
      "set-cookie": guestSetCookie(token, deps.secureCookie),
    },
  });
}
