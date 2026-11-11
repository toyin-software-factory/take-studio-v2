/**
 * The guard for /api/sentry-check (spec 0005, production check): a request may trigger the
 * deliberate error only with the exact SENTRY_CHECK_TOKEN. Compared in constant time: both
 * values are hashed to fixed length digests and every byte is compared, with no early exit.
 */

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/** True only when `given` equals `expected`, and `expected` is a real (non empty) token. */
export async function sentryCheckAllowed(
  given: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!expected || !given) return false;
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

/** The header the check request must carry. */
export const SENTRY_CHECK_HEADER = "x-sentry-check";
