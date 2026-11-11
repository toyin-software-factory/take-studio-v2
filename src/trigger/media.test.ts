import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadlineExceeded } from "@/lib/deadline";

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

describe("media tools and the job deadline (S2T-T07)", () => {
  it("kills ffmpeg when the signal aborts and settles only after the process is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-ffmpeg-"));
    try {
      // A stand in "ffmpeg" that records its pid and then sleeps for 30 s.
      const fake = join(dir, "ffmpeg");
      const pidFile = join(dir, "pid");
      await writeFile(fake, `#!/bin/sh\necho $$ > ${pidFile}\nexec sleep 30\n`);
      await chmod(fake, 0o755);
      vi.stubEnv("FFMPEG_PATH", fake);
      const { runFfmpeg } = await import("./media");
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DeadlineExceeded()), 200);

      const error = await runFfmpeg(["-i", "x"], {
        timeoutMs: 60_000,
        signal: controller.signal,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DeadlineExceeded);
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      expect(() => process.kill(pid, 0)).toThrow(); // no such process: it is dead
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects at once with the reason when the signal is already aborted", async () => {
    vi.stubEnv("FFMPEG_PATH", "/bin/false");
    const { runFfmpeg } = await import("./media");
    const reason = new DeadlineExceeded();
    await expect(
      runFfmpeg(["-i", "x"], { timeoutMs: 1000, signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });

  it("reports an aborted ffprobe as the deadline and settles only after the process is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-ffprobe-"));
    try {
      const fake = join(dir, "ffprobe");
      const pidFile = join(dir, "pid");
      await writeFile(fake, `#!/bin/sh\necho $$ > ${pidFile}\nexec sleep 30\n`);
      await chmod(fake, 0o755);
      vi.stubEnv("FFPROBE_PATH", fake);
      const { probeFile } = await import("./media");
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DeadlineExceeded()), 300);
      const error = await probeFile("/x.mp4", controller.signal).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DeadlineExceeded);
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      expect(() => process.kill(pid, 0)).toThrow(); // already dead when the promise settled
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
