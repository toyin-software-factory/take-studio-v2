import { describe, expect, it } from "vitest";
import { PartError, type UploadIo, uploadFile } from "./upload-client";
import { fakeIo, file } from "./upload-client-test-helpers";

describe("uploadFile (AC-3)", () => {
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
