import { AwsClient } from "aws4fetch";
import type { R2Env } from "./env";

/**
 * R2 over the S3 API with aws4fetch. Used by the web app (presigning) and by jobs.
 * No public bucket domain; the database stores keys, never URLs (spec 0001).
 */
export function createR2(env: R2Env) {
  const credentials = {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  };
  // The health check gets its own client with no retries: aws4fetch's retry delays
  // ignore the abort signal and could push /api/health past its timeout.
  const healthClient = new AwsClient({ ...credentials, retries: 0 });
  const bucketUrl = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;

  return {
    /** True when the bucket exists and these credentials can reach it. */
    async isReachable(): Promise<boolean> {
      const res = await healthClient.fetch(bucketUrl, {
        method: "HEAD",
        // Fail fast so a stalled R2 call can't hang /api/health.
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    },
  };
}
