import { bearerFailuresNow, countBearerFailure } from "@/db/data/api-keys";
import {
  failureWentOver,
  hashClientIp,
  isOverFailLimit,
  retryAfterFromSecond,
  retryAfterSeconds,
} from "@/lib/api-rules";
import type { ApiAuthDeps, ApiAuthError } from "./api-auth";

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
export async function failureGate(
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
