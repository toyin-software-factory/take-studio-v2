import { z } from "zod";
import { type Result, err, ok } from "@/lib/result";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

const verifySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

const PROVIDER_CODES: ReadonlySet<string> = new Set([
  "internal-error",
  "invalid-input-secret",
  "missing-input-secret",
]);

export type TurnstileError = "failed" | "unavailable";

/**
 * Verifies a Turnstile token with Cloudflare (spec 0023). `failed` means the check said no;
 * `unavailable` means we could not get an answer (timeout, bad status, bad body), which the
 * route treats as a refusal too. Nothing here logs the token or the secret.
 */
export async function verifyTurnstile(
  input: { readonly secret: string; readonly token: string; readonly ip: string },
  fetcher: typeof fetch = fetch,
): Promise<Result<true, TurnstileError>> {
  try {
    const form = new URLSearchParams({
      secret: input.secret,
      response: input.token,
      remoteip: input.ip,
    });
    const res = await fetcher(VERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return err("unavailable");
    const parsed = verifySchema.safeParse(await res.json());
    if (!parsed.success) return err("unavailable");
    if (parsed.data.success) return ok(true);
    // Provider and secret problems are not the visitor's fault: offer the sign in fallback.
    const codes = parsed.data["error-codes"] ?? [];
    return err(codes.some((c) => PROVIDER_CODES.has(c)) ? "unavailable" : "failed");
  } catch {
    return err("unavailable");
  }
}
