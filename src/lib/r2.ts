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

    /** Starts a multipart upload for `key` and returns its upload ID. */
    async createMultipartUpload(key: string, contentType: string): Promise<string> {
      const res = await client.fetch(`${objectUrl(key)}?uploads`, {
        method: "POST",
        headers: { "content-type": contentType },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.text();
      const uploadId = xmlValue(body, "UploadId");
      if (!res.ok || !uploadId) throw new Error(`R2 create multipart failed: HTTP ${res.status}`);
      return uploadId;
    },

    /**
     * A presigned PUT link for one part (query signed, no signed content headers, so the
     * browser can send the bytes as they are). `expiresSeconds` defaults to 15 minutes.
     */
    async presignUploadPart(
      key: string,
      uploadId: string,
      partNumber: number,
      expiresSeconds: number = 15 * 60,
    ): Promise<string> {
      const url = new URL(objectUrl(key));
      url.searchParams.set("partNumber", String(partNumber));
      url.searchParams.set("uploadId", uploadId);
      url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        aws: { signQuery: true },
      });
      return signed.url;
    },

    /**
     * A presigned PUT for one whole object with its content type and exact length signed, so
     * the link only accepts that type and that many bytes. `expiresSeconds` defaults to 15
     * minutes. The browser sends `Content-Type` itself; `Content-Length` follows the body.
     */
    async presignPutObject(
      key: string,
      contentType: string,
      bytes: number,
      expiresSeconds: number = 15 * 60,
    ): Promise<string> {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(bytes) },
        aws: { signQuery: true, allHeaders: true },
      });
      return signed.url;
    },

    /** Uploads one part from memory (job side) and returns its ETag without quotes. */
    async uploadPart(
      key: string,
      uploadId: string,
      partNumber: number,
      body: Uint8Array<ArrayBuffer>,
    ): Promise<string> {
      const url = `${objectUrl(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
      const res = await client.fetch(url, {
        method: "PUT",
        body,
        signal: AbortSignal.timeout(120_000),
      });
      const etag = stripQuotes(res.headers.get("etag") ?? "");
      if (!res.ok || !etag) throw new Error(`R2 upload part failed: HTTP ${res.status}`);
      return etag;
    },

    /**
     * Completes a multipart upload. R2, like S3, can answer 200 with an `<Error>` body, so the
     * body is checked too. Throws `R2CompleteError` carrying the S3 error code.
     */
    async completeMultipartUpload(
      key: string,
      uploadId: string,
      parts: readonly { readonly partNumber: number; readonly etag: string }[],
    ): Promise<void> {
      const xml = `<CompleteMultipartUpload>${parts
        .map(
          (p) =>
            `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${escapeXml(stripQuotes(p.etag))}"</ETag></Part>`,
        )
        .join("")}</CompleteMultipartUpload>`;
      const res = await client.fetch(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, {
        method: "POST",
        headers: { "content-type": "application/xml" },
        body: xml,
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.text();
      if (!res.ok || body.includes("<Error>")) {
        throw new R2CompleteError(xmlValue(body, "Code") ?? `HTTP ${res.status}`);
      }
    },

    /** Size of a stored object, or null when it doesn't exist. */
    async headObject(key: string): Promise<{ readonly size: number } | null> {
      const res = await client.fetch(objectUrl(key), {
        method: "HEAD",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 head failed: HTTP ${res.status}`);
      return { size: Number(res.headers.get("content-length") ?? "0") };
    },

    /**
     * A presigned GET link. With `disposition`, R2 answers with that Content-Disposition
     * (RFC 5987 encoded file name), e.g. `attachment` for downloads or `inline` for playback.
     */
    async presignGet(
      key: string,
      options: {
        readonly expiresSeconds: number;
        readonly disposition?: {
          readonly type: "inline" | "attachment";
          readonly fileName: string;
        };
      },
    ): Promise<string> {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(options.expiresSeconds));
      if (options.disposition) {
        url.searchParams.set(
          "response-content-disposition",
          contentDisposition(options.disposition.type, options.disposition.fileName),
        );
      }
      const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },

    /** Writes a small object in one request (e.g. a thumbnail). */
    async putObject(
      key: string,
      body: Uint8Array<ArrayBuffer>,
      contentType: string,
    ): Promise<void> {
      const res = await client.fetch(objectUrl(key), {
        method: "PUT",
        headers: { "content-type": contentType },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`R2 put failed: HTTP ${res.status}`);
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

export type R2 = ReturnType<typeof createR2>;

/** A CompleteMultipartUpload failure, with the S3 error code (e.g. `NoSuchUpload`, `InvalidPart`). */
export class R2CompleteError extends Error {
  override name = "R2CompleteError";
  constructor(readonly code: string) {
    super(`R2 complete multipart failed: ${code}`);
  }
}

/** The text of the first `<tag>` in an S3 XML body, or null. */
function xmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1] ?? null;
}

function stripQuotes(etag: string): string {
  return etag.replaceAll('"', "").trim();
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * A Content-Disposition value with an ASCII fallback `filename` and an RFC 5987
 * `filename*` for the real (possibly non ASCII) name.
 */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
