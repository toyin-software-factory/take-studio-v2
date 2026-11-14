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
});
