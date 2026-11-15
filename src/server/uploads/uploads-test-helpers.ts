import { type UploadDeps } from ".";

export const ORIGIN = "https://take-studio.example";
export const MiB = 1024 * 1024;
/** A fake R2 that records calls; behaviour can be overridden per test. */
export function fakeR2(overrides: Partial<UploadDeps["r2"]> = {}) {
  const calls: string[] = [];
  const stored = new Map<string, number>();
  const r2: UploadDeps["r2"] = {
    createMultipartUpload: async (key, contentType) => {
      calls.push(`create ${key} ${contentType}`);
      return `mpu-${crypto.randomUUID()}`;
    },
    presignUploadPart: async (key, uploadId, partNumber, expires) =>
      `https://r2.test/${key}?partNumber=${partNumber}&uploadId=${uploadId}&X-Amz-Expires=${expires}`,
    completeMultipartUpload: async (key, _uploadId, parts) => {
      calls.push(`complete ${parts.length}`);
      stored.set(key, stored.get(key) ?? -1);
    },
    abortMultipartUpload: async (key) => void calls.push(`abort ${key}`),
    headObject: async (key) => {
      const size = stored.get(key);
      return size === undefined ? null : { size };
    },
    ...overrides,
  };
  return { r2, calls, stored };
}
export function request(method: string, body?: unknown, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request("https://take-studio.example/api/uploads", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
export const file = { fileName: "Morning take.mov", sizeBytes: 40 * MiB, container: "mov" };
