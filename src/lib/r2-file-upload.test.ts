import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MultipartTarget, uploadFileMultipart } from "./r2-file-upload";
import { partCount } from "./uploads";

let dir: string;
let filePath: string;
const SIZE = 2_500; // with partSize 1_000: parts of 1000, 1000, 500

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "r2-upload-"));
  filePath = join(dir, "render.mp4");
  await writeFile(filePath, Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251)));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

function fakeTarget(failPart?: { readonly partNumber: number; readonly times: number }) {
  const received = new Map<number, Uint8Array>();
  const log: string[] = [];
  let failures = 0;
  const target: MultipartTarget = {
    createMultipartUpload: async () => "up-1",
    uploadPart: async (_key, _uploadId, partNumber, body) => {
      if (failPart && partNumber === failPart.partNumber && failures < failPart.times) {
        failures++;
        throw new Error("R2 upload part failed: HTTP 500");
      }
      received.set(partNumber, body);
      return `etag-${partNumber}`;
    },
    completeMultipartUpload: async (_key, _uploadId, parts) =>
      void log.push(`complete ${parts.map((p) => `${p.partNumber}:${p.etag}`).join(",")}`),
    abortMultipartUpload: async () => void log.push("abort"),
  };
  return { target, received, log };
}

describe("uploadFileMultipart (render upload)", () => {
  it("uploads the file in ordered parts and completes with their ETags", async () => {
    const { target, received, log } = fakeTarget();
    const size = await uploadFileMultipart(target, "renders/t/r.mp4", filePath, {
      contentType: "video/mp4",
      partSize: 1_000,
      backoffMs: 1,
    });
    expect(size).toBe(SIZE);
    expect([...received.keys()].sort()).toEqual([1, 2, 3]);
    expect(received.get(3)?.length).toBe(500);
    expect(received.get(2)?.[0]).toBe(1_000 % 251);
    expect(log).toEqual(["complete 1:etag-1,2:etag-2,3:etag-3"]);
  });

  it("retries a failing part and still completes", async () => {
    const { target, log } = fakeTarget({ partNumber: 2, times: 2 });
    await uploadFileMultipart(target, "k", filePath, {
      contentType: "video/mp4",
      partSize: 1_000,
      attempts: 3,
      backoffMs: 1,
    });
    expect(log).toEqual(["complete 1:etag-1,2:etag-2,3:etag-3"]);
  });

  it("aborts the upload and rethrows when a part keeps failing", async () => {
    const { target, log } = fakeTarget({ partNumber: 2, times: 5 });
    await expect(
      uploadFileMultipart(target, "k", filePath, {
        contentType: "video/mp4",
        partSize: 1_000,
        attempts: 3,
        backoffMs: 1,
      }),
    ).rejects.toThrow("HTTP 500");
    expect(log).toEqual(["abort"]);
  });
});

describe("partCount", () => {
  it("is ceil(size / 16 MiB), at least 1", () => {
    const MiB = 1024 * 1024;
    expect(partCount(16 * MiB)).toBe(1);
    expect(partCount(16 * MiB + 1)).toBe(2);
    expect(partCount(1)).toBe(1);
    expect(partCount(2 * 1024 ** 3)).toBe(128);
  });
});
