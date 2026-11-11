import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("media tools (spec 0004 privacy rule)", () => {
  it("never puts the presigned URL in an error when ffprobe fails", async () => {
    // A stand in "ffprobe" that always fails, so this runs without ffmpeg installed.
    vi.stubEnv("FFPROBE_PATH", "/bin/false");
    const { probeUrl, MediaToolError } = await import("./media");
    const url =
      "https://acct.r2.cloudflarestorage.com/b/originals/t/source.mp4?X-Amz-Signature=SECRET123";

    const error = await probeUrl(url).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaToolError);
    expect(String(error)).toBe("MediaToolError: ffprobe failed (exit 1)");
    expect(JSON.stringify(error)).not.toContain("SECRET123");
    expect(String((error as Error).stack)).not.toContain("SECRET123");
  });

  it("spells out the input transfer for zscale (PQ and HLG)", async () => {
    const { toneMapFilter } = await import("./media");
    expect(toneMapFilter("smpte2084")).toBe(
      "zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p",
    );
    expect(toneMapFilter("arib-std-b67")).toContain("zscale=tin=arib-std-b67:");
  });
});
