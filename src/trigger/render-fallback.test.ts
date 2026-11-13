import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { probeFile } from "./media";
import {
  type RenderPlan,
  encodeRender,
  outputIsOnlyBackground,
  renderWithFallback,
} from "./render-fallback";

// RF3-T05 (spec 0008 AC-13): a full render whose output is only the background is not shipped.
// Real ffmpeg on tiny generated fixtures.

const GREEN = "0x00B140";
const KEY = "#00b140";
let work: string;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "render-fallback-"));
});
afterAll(() => rm(work, { recursive: true, force: true }));

const ffmpeg = (args: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "pipe" });

function fixtures() {
  const image = join(work, "bg.jpg");
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:d=1", "-frames:v", "1", image]);
  // Green all over: keying it away erases everything, so the keyed output is only the background.
  const empty = join(work, "empty.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${GREEN}:s=640x360:d=2:r=25`,
    "-pix_fmt",
    "yuv420p",
    empty,
  ]);
  // A person (a block) standing in the middle of the green.
  const person = join(work, "person.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${GREEN}:s=640x360:d=2:r=25,drawbox=x=220:y=40:w=200:h=320:color=0xC08060:t=fill`,
    "-pix_fmt",
    "yuv420p",
    person,
  ]);
  return { image, empty, person };
}

const planFor = (source: string, imagePath: string, output: string): RenderPlan => ({
  source,
  keep: [{ startMs: 0, endMs: 2000 }],
  facts: { width: 640, height: 360, fps: 25, hdrTransfer: null, hasAudio: false },
  work,
  output,
  background: { imagePath, keyColor: KEY },
  timeoutMs: 60_000,
});

async function gate(plan: RenderPlan) {
  const probed = await probeFile(plan.output);
  return outputIsOnlyBackground({
    output: plan.output,
    imagePath: plan.background!.imagePath,
    width: 640,
    height: 360,
    durationMs: probed!.durationMs,
  });
}

describeWithFfmpeg("final render gate (RF3-T05)", () => {
  it("flags a keyed output with the person erased and passes one with a person in it", async () => {
    const { image, empty, person } = fixtures();
    const erased = planFor(empty, image, join(work, "erased.mp4"));
    await encodeRender(erased, true, {});
    expect(await gate(erased)).toBe(true);

    const real = planFor(person, image, join(work, "real.mp4"));
    await encodeRender(real, true, {});
    expect(await gate(real)).toBe(false);
  });

  it("does not ship the erased render: the plain render replaces it and the row is marked unkeyed", async () => {
    const { image, empty } = fixtures();
    const plan = planFor(empty, image, join(work, "fallback.mp4"));
    const markUnkeyed = vi.fn(async () => {});
    const result = await renderWithFallback({
      renderKeyed: () => encodeRender(plan, true, {}),
      isErased: () => gate(plan),
      markUnkeyed,
      renderPlain: () => encodeRender(plan, false, {}),
    });
    expect(result).toEqual({ keyed: false });
    expect(markUnkeyed).toHaveBeenCalledTimes(1);
    // The file that ships is the original (green all over), no longer the background.
    expect(await gate(plan)).toBe(false);
  });

  it("ships a keyed render untouched when the person is there", async () => {
    const { image, person } = fixtures();
    const plan = planFor(person, image, join(work, "keyed.mp4"));
    const markUnkeyed = vi.fn(async () => {});
    const renderPlain = vi.fn(async () => {});
    const result = await renderWithFallback({
      renderKeyed: () => encodeRender(plan, true, {}),
      isErased: () => gate(plan),
      markUnkeyed,
      renderPlain,
    });
    expect(result).toEqual({ keyed: true });
    expect(markUnkeyed).not.toHaveBeenCalled();
    expect(renderPlain).not.toHaveBeenCalled();
  });
});
