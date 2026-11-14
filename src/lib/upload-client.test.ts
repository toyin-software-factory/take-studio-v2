import { describe, expect, it } from "vitest";
import { type ApiReply, PartError, type UploadIo, uploadFile } from "./upload-client";

/** A file of `size` bytes; the server plan below cuts it in 16 byte parts. */
const file = (size = 40) => Object.assign(new Blob([new Uint8Array(size)]), { name: "take.mp4" });

type Call = { readonly path: string; readonly method: string; readonly body?: unknown };

/**
 * A fake API and R2. `putPart` answers from `put(partNumber, attempt)`: an ETag, or a status
 * to fail with. Links carry their part number and a batch counter, so tests see refreshes.
 */
function fakeIo(options: {
  readonly put?: (part: number, attempt: number) => string | number;
  readonly create?: ApiReply;
  readonly complete?: readonly ApiReply[];
  readonly linkSeconds?: number;
  readonly onPut?: (part: number) => void;
}) {
  const calls: Call[] = [];
  const attempts = new Map<number, number>();
  const sleeps: number[] = [];
  let clock = 0;
  let batches = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const completes = [
    ...(options.complete ?? [{ status: 200, data: { takeId: "t1", status: "uploading" } }]),
  ];

  const io: UploadIo = {
    api: async (path, method, body) => {
      calls.push({ path, method, body });
      if (path === "/api/uploads") {
        return (
          options.create ?? { status: 201, data: { takeId: "t1", partSize: 16, partCount: 3 } }
        );
      }
      if (path.endsWith("/parts")) {
        batches += 1;
        const numbers = (body as { partNumbers: number[] }).partNumbers;
        return {
          status: 200,
          data: {
            parts: numbers.map((n) => ({
              partNumber: n,
              url: `https://r2.test/${n}?b=${batches}`,
            })),
            expiresInSeconds: options.linkSeconds ?? 900,
          },
        };
      }
      if (path.endsWith("/complete"))
        return completes.length > 1 ? completes.shift()! : completes[0]!;
      return { status: 200, data: { takeId: "t1", status: "uploading" } };
    },
    putPart: async (url, body, onSent) => {
      const part = Number(new URL(url).pathname.slice(1));
      const attempt = (attempts.get(part) ?? 0) + 1;
      attempts.set(part, attempt);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      options.onPut?.(part);
      await Promise.resolve();
      inFlight -= 1;
      const answer = options.put?.(part, attempt) ?? `"etag-${part}"`.replaceAll('"', "");
      if (typeof answer === "number") throw new PartError(answer);
      onSent(body.size);
      return answer;
    },
    now: () => clock,
    sleep: async (ms, signal) => {
      if (signal.aborted) throw signal.reason;
      sleeps.push(ms);
      clock += ms;
    },
  };
  return {
    io,
    calls,
    sleeps,
    attempts,
    advance: (ms: number) => (clock += ms),
    stats: () => ({ batches, maxInFlight }),
  };
}

describe("uploadFile (AC-3)", () => {
  it("uploads equal parts 3 at a time, then completes with the ETags in order", async () => {
    const fake = fakeIo({});
    const progress: number[] = [];
    const phases: string[] = [];
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal, {
      onProgress: (p) => progress.push(p),
      onPhase: (p) => phases.push(p),
    });

    expect(outcome).toEqual({ ok: true, takeId: "t1" });
    expect(fake.calls[0]).toEqual({
      path: "/api/uploads",
      method: "POST",
      body: { fileName: "take.mp4", sizeBytes: 40, container: "mp4" },
    });
    expect(fake.stats()).toEqual({ batches: 1, maxInFlight: 3 });
    expect(fake.calls.at(-1)).toEqual({
      path: "/api/uploads/t1/complete",
      method: "POST",
      body: {
        parts: [
          { partNumber: 1, etag: "etag-1" },
          { partNumber: 2, etag: "etag-2" },
          { partNumber: 3, etag: "etag-3" },
        ],
      },
    });
    expect(progress.at(-1)).toBe(100);
    expect(phases).toEqual(["uploading", "completing"]);
  });

  it("sends source recording, a webm container and the script for a recording (spec 0021)", async () => {
    const fake = fakeIo({});
    await uploadFile(file(), "webm", fake.io, new AbortController().signal, {}, undefined, {
      script: "Hello there",
    });
    expect(fake.calls[0]?.body).toEqual({
      fileName: "take.mp4",
      sizeBytes: 40,
      container: "webm",
      source: "recording",
      script: "Hello there",
    });
  });

  it("leaves the script out when it is blank", async () => {
    const fake = fakeIo({});
    await uploadFile(file(), "mp4", fake.io, new AbortController().signal, {}, undefined, {
      script: "  \n ",
    });
    expect(fake.calls[0]?.body).toEqual({
      fileName: "take.mp4",
      sizeBytes: 40,
      container: "mp4",
      source: "recording",
    });
  });

  it("retries a failing part with backoff and still succeeds", async () => {
    const fake = fakeIo({ put: (part, attempt) => (part === 2 && attempt < 3 ? 500 : `e${part}`) });
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal);
    expect(outcome.ok).toBe(true);
    expect(fake.attempts.get(2)).toBe(3);
    expect(fake.sleeps).toEqual([1000, 2000]);
  });

  it("asks for a fresh link when R2 refuses an expired one (403)", async () => {
    const fake = fakeIo({
      put: (part, attempt) => (part === 1 && attempt === 1 ? 403 : `e${part}`),
    });
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal);
    expect(outcome.ok).toBe(true);
    expect(fake.stats().batches).toBe(2);
    const refresh = fake.calls.filter((c) => c.path.endsWith("/parts"))[1];
    expect(refresh?.body).toEqual({ partNumbers: [1] });
  });

  it("refreshes links that are about to expire before using them", async () => {
    const fake: ReturnType<typeof fakeIo> = fakeIo({
      // 61 s links are stale a second after issue (60 s margin); each PUT takes 2 s.
      linkSeconds: 61,
      create: { status: 201, data: { takeId: "t1", partSize: 16, partCount: 5 } },
      onPut: () => fake.advance(2000),
    });
    const outcome = await uploadFile(file(80), "mp4", fake.io, new AbortController().signal);
    expect(outcome.ok).toBe(true);
    // Parts 4 and 5 start after the first links went stale, so they ask again.
    expect(fake.stats().batches).toBeGreaterThan(1);
  });

  it("gives up after 4 attempts, tells the server, and shows a friendly message", async () => {
    const fake = fakeIo({ put: (part) => (part === 3 ? 0 : `e${part}`) });
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal);
    expect(outcome).toEqual({
      ok: false,
      reason: "failed",
      message: "The upload didn't go through. Check your connection and try again.",
    });
    expect(fake.attempts.get(3)).toBe(4);
    expect(fake.calls.at(-1)).toEqual({
      path: "/api/uploads/t1",
      method: "DELETE",
      body: undefined,
    });
  });

  it("shows the server's message when the upload can't start (limit, type)", async () => {
    const message = "You've started 10 uploads in the last hour. Try again a little later.";
    const fake = fakeIo({ create: { status: 429, data: { error: "rate_limited", message } } });
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, reason: "failed", message });
    expect(fake.calls).toHaveLength(1);
  });

  it("cancels: stops, abandons the upload on the server, and reports cancelled", async () => {
    const abort = new AbortController();
    const fake = fakeIo({ onPut: () => abort.abort() });
    const outcome = await uploadFile(file(), "mp4", fake.io, abort.signal);
    expect(outcome).toEqual({ ok: false, reason: "cancelled" });
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/uploads/t1", method: "DELETE" });
    expect(fake.calls.some((c) => c.path.endsWith("/complete"))).toBe(false);
  });

  it("retries completion while the server is unavailable (503)", async () => {
    const fake = fakeIo({
      complete: [
        { status: 503, data: { error: "dispatch_failed", message: "Your upload is safe…" } },
        { status: 200, data: { takeId: "t1", status: "uploading" } },
      ],
    });
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal);
    expect(outcome).toEqual({ ok: true, takeId: "t1" });
  });

  it("reports a size mismatch without abandoning (the server already failed the take)", async () => {
    const message = "The uploaded file doesn't match the file you chose. Please upload it again.";
    const fake = fakeIo({ complete: [{ status: 422, data: { error: "size_mismatch", message } }] });
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, reason: "failed", message });
    expect(fake.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("abandons the take when the server refuses the part list (bad_parts leaves it uploading)", async () => {
    const message = "The upload didn't come through completely. Please try again.";
    const fake = fakeIo({ complete: [{ status: 422, data: { error: "bad_parts", message } }] });
    const outcome = await uploadFile(file(), "mp4", fake.io, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, reason: "failed", message });
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/uploads/t1", method: "DELETE" });
  });

  it("stops and waits for the other parts when one part gives up", async () => {
    const fake = fakeIo({});
    const stopped: number[] = [];
    const io: UploadIo = {
      ...fake.io,
      putPart: (url, _body, _onSent, signal) => {
        const part = Number(new URL(url).pathname.slice(1));
        if (part === 3) return Promise.reject(new PartError(0));
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              stopped.push(part);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    };
    const outcome = await uploadFile(file(), "mp4", io, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(stopped.sort()).toEqual([1, 2]);
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/uploads/t1", method: "DELETE" });
  });
});
