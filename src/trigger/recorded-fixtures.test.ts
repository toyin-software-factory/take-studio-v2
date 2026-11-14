import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
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
