import type { GuestHttpDeps } from "./http";
import type { UploadDeps } from "../uploads/base";

export const ORIGIN = "https://take-studio.example";
export const MiB = 1024 * 1024;
/** Cloudflare's documented Turnstile test secrets: always pass, always fail. */
export const TEST_SECRET_PASS = "1x0000000000000000000000000000000AA";
export const TEST_SECRET_FAIL = "2x0000000000000000000000000000000AA";

export const body = {
  fileName: "Drop.mov",
  sizeBytes: 40 * MiB,
  container: "mov",
  turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
};

export function guestRequest(
  payload: unknown = body,
  extra: Readonly<Record<string, string>> = {},
): Request {
  return new Request(`${ORIGIN}/api/guest/uploads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "cf-connecting-ip": "203.0.113.7",
      ...extra,
    },
    body: JSON.stringify(payload),
  });
}

export function guestDeps(
  uploadDeps: UploadDeps,
  overrides: Partial<GuestHttpDeps> = {},
): GuestHttpDeps {
  return {
    appOrigin: ORIGIN,
    secureCookie: true,
    hashSecret: () => "x".repeat(40),
    env: { TURNSTILE_SECRET_KEY: TEST_SECRET_PASS },
    uploadDeps: async () => uploadDeps,
    verify: async () => ({ ok: true, data: true }),
    ...overrides,
  };
}
