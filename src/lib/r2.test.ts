import { afterEach, describe, expect, it, vi } from "vitest";
import { R2CompleteError, contentDisposition, createR2 } from "./r2";

// Fake credentials: presigning is local maths, and fetch is stubbed where a call is made.
const r2 = createR2({
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "take-studio",
});

afterEach(() => vi.restoreAllMocks());

describe("presigned links (AC-12)", () => {
  it("signs a part PUT by query only, for 15 minutes, with no signed content headers", async () => {
    const url = new URL(await r2.presignUploadPart("originals/t1/source.mp4", "up-1", 3));
    expect(url.origin).toBe("https://acct.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/take-studio/originals/t1/source.mp4");
    expect(url.searchParams.get("partNumber")).toBe("3");
    expect(url.searchParams.get("uploadId")).toBe("up-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs a GET with the requested lifetime and Content-Disposition", async () => {
    const url = new URL(
      await r2.presignGet("renders/t1/r1.mp4", {
        expiresSeconds: 3600,
        disposition: { type: "attachment", fileName: "Café take-trimmed.mp4" },
      }),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="Caf_ take-trimmed.mp4"; filename*=UTF-8''Caf%C3%A9%20take-trimmed.mp4`,
    );
  });
});

describe("contentDisposition", () => {
  it("keeps an ASCII fallback and an RFC 5987 encoded name", () => {
    expect(contentDisposition("inline", `my "best" take.mp4`)).toBe(
      `inline; filename="my _best_ take.mp4"; filename*=UTF-8''my%20%22best%22%20take.mp4`,
    );
    expect(contentDisposition("attachment", "take's (1).mp4")).toContain(
      "filename*=UTF-8''take%27s%20%281%29.mp4",
    );
  });
});

describe("completeMultipartUpload", () => {
  it("treats an <Error> body as a failure even when R2 answers 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<Error><Code>InternalError</Code><Message>retry</Message></Error>", {
        status: 200,
      }),
    );
    const promise = r2.completeMultipartUpload("k", "u", [{ partNumber: 1, etag: "e" }]);
    await expect(promise).rejects.toBeInstanceOf(R2CompleteError);
    await expect(promise).rejects.toMatchObject({ code: "InternalError" });
  });

  it("sends the parts as XML with quoted ETags", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<CompleteMultipartUploadResult/>", { status: 200 }));
    await r2.completeMultipartUpload("k", "u", [
      { partNumber: 1, etag: '"a"' },
      { partNumber: 2, etag: "b" },
    ]);
    const sent = spy.mock.calls[0]?.[0] as Request;
    expect(await sent.text()).toBe(
      `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"a"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"b"</ETag></Part></CompleteMultipartUpload>`,
    );
  });
});

describe("headObject and createMultipartUpload", () => {
  it("returns null for a missing object and the size otherwise", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await r2.headObject("missing")).toBeNull();
    spy.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { "content-length": "1234" } }),
    );
    expect(await r2.headObject("there")).toEqual({ size: 1234 });
  });

  it("reads the upload ID from the XML answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        "<InitiateMultipartUploadResult><UploadId>abc123</UploadId></InitiateMultipartUploadResult>",
      ),
    );
    expect(await r2.createMultipartUpload("k", "video/mp4")).toBe("abc123");
  });
});

describe("putObject and the job deadline", () => {
  it("passes the caller's signal to the request, so an aborted attempt stops its upload", async () => {
    let seen: AbortSignal | undefined;
    // aws4fetch signs the call and hands fetch a Request, which carries the signal.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen = (input instanceof Request ? input.signal : init?.signal) ?? undefined;
      return new Response(null, { status: 200 });
    });
    const controller = new AbortController();
    await r2.putObject("previews/t/p.jpg", new Uint8Array([1]), "image/jpeg", {
      signal: controller.signal,
    });
    expect(seen?.aborted).toBe(false);
    controller.abort(new Error("deadline"));
    expect(seen?.aborted).toBe(true);
  });

  it("still has its own 30 s limit without a signal", async () => {
    let seen: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen = (input instanceof Request ? input.signal : init?.signal) ?? undefined;
      return new Response(null, { status: 200 });
    });
    await r2.putObject("previews/t/p.jpg", new Uint8Array([1]), "image/jpeg");
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);
  });
});
