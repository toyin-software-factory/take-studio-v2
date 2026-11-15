import { type ApiReply, PartError, type UploadIo } from "./upload-client";

/** A file of `size` bytes; the server plan below cuts it in 16 byte parts. */
export const file = (size = 40) =>
  Object.assign(new Blob([new Uint8Array(size)]), { name: "take.mp4" });
export type Call = { readonly path: string; readonly method: string; readonly body?: unknown };
/**
 * A fake API and R2. `putPart` answers from `put(partNumber, attempt)`: an ETag, or a status
 * to fail with. Links carry their part number and a batch counter, so tests see refreshes.
 */
export function fakeIo(options: {
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
