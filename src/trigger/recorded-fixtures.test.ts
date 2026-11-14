import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { renderFilterScript, renderLengthSeconds } from "@/lib/trim";
import { probeFile } from "./media";

// Spec 0021 AC-4: the two files a browser recording makes, run through the real probe.
// `tests/fixtures/make-recorded-media.sh` writes them: a Chrome style WebM with no duration in the
// header (so the length has to come from the packets) and a Safari style fragmented MP4.
const file = (name: string) =>
  fileURLToPath(new URL(`../../tests/fixtures/media/${name}`, import.meta.url));

describeWithFfmpeg("recorded take fixtures (spec 0021 AC-4)", () => {
  it("reads a WebM with no duration in its header from the last packet", async () => {
    const facts = await probeFile(file("recorded-chrome.webm"));
    expect(facts).toMatchObject({ container: "webm", hasAudio: true, width: 320, height: 180 });
    // 10 s of video; the last packet ends within a frame of that.
    expect(facts?.durationMs).toBeGreaterThan(9_900);
    expect(facts?.durationMs).toBeLessThan(10_100);
  });

  it("reads a fragmented H.264 and AAC MP4 as an mp4", async () => {
    const facts = await probeFile(file("recorded-safari.mp4"));
    expect(facts).toMatchObject({ container: "mp4", hasAudio: true, width: 320, height: 180 });
    expect(facts?.durationMs).toBeGreaterThan(9_900);
    expect(facts?.durationMs).toBeLessThan(10_100);
  });

  it("keeps both fixtures small and synthetic (under 1 MB each)", () => {
    for (const name of ["recorded-chrome.webm", "recorded-safari.mp4"]) {
      expect(statSync(file(name)).size).toBeLessThan(1_000_000);
    }
  });
});

// B2-T96: the Safari style MP4 has audio running past its video, so a render with no length cap
// came out 45 ms longer than the cut plan. The job ends the file at the plan's length.
describeWithFfmpeg("recorded take render length (B2-T96)", () => {
  for (const name of ["recorded-safari.mp4", "recorded-chrome.webm"]) {
    it(`renders ${name} as long as the plan, original minus the cut`, async () => {
      const facts = await probeFile(file(name));
      const durationMs = facts?.durationMs ?? 0;
      const keep = [
        { startMs: 0, endMs: 3000 },
        { startMs: 5000, endMs: durationMs },
      ];
      const dir = mkdtempSync(join(tmpdir(), "render-length-"));
      try {
        const graph = renderFilterScript(keep, { hdr: null, hasAudio: true, durationMs, fps: 30 });
        const output = join(dir, "out.mp4");
        const run = spawnSync(
          "ffmpeg",
          [
            "-y",
            "-f",
            name.endsWith(".webm") ? "matroska" : "mov",
            "-i",
            file(name),
            "-filter_complex",
            graph,
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-fps_mode",
            "cfr",
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            "-t",
            renderLengthSeconds(keep),
            output,
          ],
          { encoding: "utf8" },
        );
        expect(run.status).toBe(0);
        const probe = spawnSync(
          "ffprobe",
          ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output],
          { encoding: "utf8" },
        );
        const renderMs = Math.round(Number(probe.stdout.trim()) * 1000);
        const expectedMs = durationMs - 2000;
        expect(Math.abs(renderMs - expectedMs)).toBeLessThanOrEqual(40);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
