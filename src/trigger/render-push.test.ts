import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { probeFile } from "./media";
import { type RenderPlan, encodeRender } from "./render-fallback";

// Spec 0020 AC-7: a render with zoom and the slow push keeps the size and the length.
// Real ffmpeg on a small generated take with sound.

let work: string;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "render-push-"));
});
afterAll(() => rm(work, { recursive: true, force: true }));

const ffmpeg = (args: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "pipe" });

describeWithFfmpeg("render with zoom and slow push (spec 0020 AC-7)", () => {
  it("keeps the output size and the kept length", async () => {
    const source = join(work, "take.mp4");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=640x360:d=8:r=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:d=8",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      source,
    ]);
    const keep = [
      { startMs: 0, endMs: 2_000 },
      { startMs: 3_000, endMs: 5_000 },
      { startMs: 5_500, endMs: 5_900 },
      { startMs: 6_000, endMs: 8_000 },
    ];
    const plan: RenderPlan = {
      source,
      keep,
      facts: {
        width: 640,
        height: 360,
        durationMs: 8_000,
        fps: 25,
        hdrTransfer: null,
        hasAudio: true,
      },
      work,
      output: join(work, "out.mp4"),
      background: null,
      timeoutMs: 60_000,
    };
    await encodeRender(plan, false, {});
    const facts = await probeFile(plan.output);
    expect(facts?.width).toBe(640);
    expect(facts?.height).toBe(360);
    const keptMs = keep.reduce((sum, r) => sum + r.endMs - r.startMs, 0);
    expect(Math.abs((facts?.durationMs ?? 0) - keptMs)).toBeLessThan(200);
  });
  it("keeps a stationary centre marker centred while an unzoomed piece pushes", async () => {
    // crop reads the input size once, so its default centring drifts as the scaled frame grows.
    const source = join(work, "marker.mp4");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=640x360:d=8:r=25,drawbox=x=270:y=130:w=100:h=100:color=white:t=fill",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:d=8",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      source,
    ]);
    // Pieces 0 to 2 are plain, short or zoomed; piece 3 flips back to unzoomed and pushes 1.00 to 1.04.
    const keep = [
      { startMs: 0, endMs: 2_000 },
      { startMs: 3_000, endMs: 5_000 },
      { startMs: 5_500, endMs: 5_900 },
      { startMs: 6_000, endMs: 8_000 },
    ];
    const plan: RenderPlan = {
      source,
      keep,
      facts: {
        width: 640,
        height: 360,
        durationMs: 8_000,
        fps: 25,
        hdrTransfer: null,
        hasAudio: true,
      },
      work,
      output: join(work, "marker-out.mp4"),
      background: null,
      timeoutMs: 60_000,
    };
    await encodeRender(plan, false, {});
    // 6.3 s is near the end of the last piece (it starts at 4.4 s of output), push about 95% done.
    const frame = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        "6.3",
        "-i",
        plan.output,
        "-frames:v",
        "1",
        "-vf",
        "format=gray",
        "-f",
        "rawvideo",
        "-",
      ],
      { stdio: "pipe", maxBuffer: 640 * 360 * 4 },
    );
    expect(frame.length).toBe(640 * 360);
    let minX = 640;
    let maxX = -1;
    let minY = 360;
    let maxY = -1;
    for (let y = 0; y < 360; y++)
      for (let x = 0; x < 640; x++)
        if ((frame[y * 640 + x] ?? 0) > 200) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
    expect(maxX).toBeGreaterThan(minX);
    expect(Math.abs((minX + maxX) / 2 - 320)).toBeLessThanOrEqual(2);
    expect(Math.abs((minY + maxY) / 2 - 180)).toBeLessThanOrEqual(2);
    // And it did push: the marker is bigger than the 100 px it started at.
    expect(maxX - minX).toBeGreaterThan(102);
  });
});
