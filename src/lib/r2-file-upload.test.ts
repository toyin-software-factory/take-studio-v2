import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DeadlineExceeded } from "./deadline";
import { type MultipartTarget, downloadToFile, uploadFileMultipart } from "./r2-file-upload";
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

describe("uploadFileMultipart stops cleanly on failure", () => {
  it("stops the other workers and uploads nothing after the abort", async () => {
    const events: string[] = [];
    const target: MultipartTarget = {
      createMultipartUpload: async () => "up-1",
      uploadPart: async (_k, _u, partNumber) => {
        events.push(`start ${partNumber}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (partNumber === 2) throw new Error("R2 upload part failed: HTTP 500");
        events.push(`done ${partNumber}`);
        return `etag-${partNumber}`;
      },
      completeMultipartUpload: async () => void events.push("complete"),
      abortMultipartUpload: async () => void events.push("abort"),
    };
    await expect(
      uploadFileMultipart(target, "k", filePath, {
        contentType: "video/mp4",
        partSize: 100, // 25 parts
        attempts: 2,
        backoffMs: 1,
        concurrency: 3,
      }),
    ).rejects.toThrow("HTTP 500");

    const abortAt = events.indexOf("abort");
    expect(abortAt).toBe(events.length - 1);
    expect(events).not.toContain("complete");
    // Far fewer than 25 parts were started: the workers stopped after the failure.
    expect(events.filter((e) => e.startsWith("start")).length).toBeLessThan(10);
  });
});

describe("uploadFileMultipart refuses a file that shrinks mid upload", () => {
  it("errors and aborts instead of sending a zero padded part", async () => {
    const path = join(dir, "shrinking.mp4");
    await writeFile(path, Buffer.alloc(1_000, 7));
    const log: string[] = [];
    const target: MultipartTarget = {
      createMultipartUpload: async () => "up-1",
      uploadPart: async (_k, _u, partNumber) => {
        // The first part truncates the file, so later reads come up short.
        if (partNumber === 1) await truncate(path, 250);
        return `etag-${partNumber}`;
      },
      completeMultipartUpload: async () => void log.push("complete"),
      abortMultipartUpload: async () => void log.push("abort"),
    };
    await expect(
      uploadFileMultipart(target, "k", path, {
        contentType: "video/mp4",
        partSize: 200,
        concurrency: 1,
        backoffMs: 1,
      }),
    ).rejects.toThrow("render file changed during upload");
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

describe("the job deadline (S2T-T07)", () => {
  it("stops taking parts, aborts the multipart upload and throws the signal's reason", async () => {
    const { target, log } = fakeTarget();
    const controller = new AbortController();
    const uploadPart = target.uploadPart;
    let sent = 0;
    target.uploadPart = async (...args) => {
      sent += 1;
      controller.abort(new DeadlineExceeded());
      return uploadPart(...args);
    };
    const error = await uploadFileMultipart(target, "k", filePath, {
      contentType: "video/mp4",
      partSize: 1_000,
      concurrency: 1,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeadlineExceeded);
    expect(sent).toBe(1);
    expect(log).toEqual(["abort"]);
  });

  it("aborts an open download and keeps the URL out of the error", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    try {
      setTimeout(() => controller.abort(new DeadlineExceeded()), 20);
      const error = await downloadToFile(
        "https://r2.test/x?X-Amz-Signature=SECRET",
        join(dir, "out.mp4"),
        controller.signal,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DeadlineExceeded);
      expect(JSON.stringify(error)).not.toContain("SECRET");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("starts no further attempt and ends the back off once the deadline fires", async () => {
    const { target, log } = fakeTarget();
    const controller = new AbortController();
    let tries = 0;
    target.uploadPart = async () => {
      tries += 1;
      // The part fails; during the (long) back off the deadline fires.
      setTimeout(() => controller.abort(new DeadlineExceeded()), 20);
      throw new Error("R2 upload part failed: HTTP 500");
    };
    const started = Date.now();
    const error = await uploadFileMultipart(target, "k", filePath, {
      contentType: "video/mp4",
      partSize: 1_000,
      concurrency: 1,
      attempts: 5,
      backoffMs: 30_000,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeadlineExceeded);
    expect(tries).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(log).toEqual(["abort"]);
  });
});
