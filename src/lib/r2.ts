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
  const client = new AwsClient({ ...credentials, retries: 2 });
  const bucketUrl = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  const objectUrl = (key: string) =>
    `${bucketUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    /**
     * Deletes an object. Deleting a key that doesn't exist succeeds (S3 semantics), so
     * retries and repeats are safe. Throws with the HTTP status (never the key) on failure.
     */
    async deleteObject(key: string): Promise<void> {
      const res = await client.fetch(objectUrl(key), {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed: HTTP ${res.status}`);
    },

    /**
     * Aborts a multipart upload, freeing its parts. An upload that no longer exists
     * (completed or already aborted) counts as done.
     */
    async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
      const url = `${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`;
      const res = await client.fetch(url, {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok && res.status !== 404) throw new Error(`R2 abort failed: HTTP ${res.status}`);
    },

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
