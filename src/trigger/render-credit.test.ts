import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CREDIT_PNG_PATH } from "@/lib/credit-filter";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { probeFile } from "./media";
import {
  type RenderPlan,
  creditStartSeconds,
  encodeRender,
  outputIsOnlyBackground,
} from "./render-fallback";

// Spec 0026 AC-1, AC-2, AC-10 and the pipeline check: the credit is in the last seconds, top
// left, and the length, the sound and the rest of the picture are the same. Real ffmpeg, a
// generated take.

const W = 640;
const H = 360;
const SECONDS = 12;
let work: string;
let source: string;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "render-credit-"));
  source = join(work, "take.mp4");
  ffmpeg([
    ...["-f", "lavfi", "-i", `color=c=0x6090c0:s=${W}x${H}:d=${SECONDS}:r=25`],
    ...["-f", "lavfi", "-i", `sine=frequency=440:d=${SECONDS}`],
    ...["-pix_fmt", "yuv420p", "-shortest", source],
  ]);
});
afterAll(() => rm(work, { recursive: true, force: true }));

const ffmpeg = (args: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "pipe" });

const planFor = (output: string, credit: boolean): RenderPlan => ({
  source,
  keep: [{ startMs: 0, endMs: SECONDS * 1000 }],
  facts: {
    width: W,
    height: H,
    durationMs: SECONDS * 1000,
    fps: 25,
    hdrTransfer: null,
    hasAudio: true,
  },
  work,
  output,
  background: null,
  timeoutMs: 60_000,
  credit: credit ? { pngPath: resolve(process.cwd(), CREDIT_PNG_PATH), timeoutMs: 60_000 } : null,
});

/** Mean grey level (0 to 255) of the credit's area in the frame at `at` seconds. */
function creditAreaLevel(file: string, at: number): number {
  // 5% inset, 256 wide (40% of 360 is 144, so the box is 144 wide, about 17 high).
  const frame = execFileSync(
    "ffmpeg",
    [...["-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1"]].concat([
      "-vf",
      "crop=100:8:36:20,format=gray",
      "-f",
      "rawvideo",
      "-",
    ]),
    { stdio: "pipe", maxBuffer: 100 * 8 * 4 },
  );
  return frame.reduce((sum, v) => sum + v, 0) / frame.length;
}

describeWithFfmpeg("render with the credit (spec 0026)", () => {
  it("shows the credit in the last 4 s only, and keeps length, audio and picture", async () => {
    const plain = planFor(join(work, "plain.mp4"), false);
    const credited = planFor(join(work, "credited.mp4"), true);
    await encodeRender(plain, false, {});
    await encodeRender(credited, false, {});
    const a = await probeFile(plain.output);
    const b = await probeFile(credited.output);
    expect(b?.durationMs).toBe(a?.durationMs);
    expect(b?.hasAudio).toBe(true);
    expect(b?.width).toBe(W);
    expect(b?.height).toBe(H);
    // Before the last 4 s the credited picture matches the plain one; inside it the box is dark.
    expect(
      Math.abs(creditAreaLevel(credited.output, 3) - creditAreaLevel(plain.output, 3)),
    ).toBeLessThan(3);
    expect(
      creditAreaLevel(plain.output, 10) - creditAreaLevel(credited.output, 10),
    ).toBeGreaterThan(20);
  });

  it("encodes a credited keyed render, with the image as input 2", async () => {
    const image = join(work, "bg.jpg");
    ffmpeg(["-f", "lavfi", "-i", `color=c=0x203040:s=${W}x${H}:d=1`, "-frames:v", "1", image]);
    const plan: RenderPlan = {
      ...planFor(join(work, "keyed.mp4"), true),
      background: { imagePath: image, keyColor: "#6090c0" },
    };
    await encodeRender(plan, true, {});
    const facts = await probeFile(plan.output);
    expect(facts?.hasAudio).toBe(true);
    expect(Math.abs((facts?.durationMs ?? 0) - SECONDS * 1000)).toBeLessThan(200);
  });

  it("reads the keyed gate before the credit on a short clip (spec 0026 AC-11)", async () => {
    // A person is on screen for the first 2 s of a 6 s clip. The credit starts at 3 s, which is
    // also the middle: the old centre read would see only the background and erase the person.
    const green = "0x00B140";
    const short = join(work, "short.mp4");
    ffmpeg([
      ...[
        "-f",
        "lavfi",
        "-i",
        `color=c=${green}:s=360x640:d=6:r=25,drawbox=x=100:y=160:w=160:h=320:color=0xC08060:t=fill:enable='lt(t,2)'`,
      ],
      ...["-pix_fmt", "yuv420p", short],
    ]);
    const image = join(work, "portrait-bg.jpg");
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=360x640:d=1", "-frames:v", "1", image]);
    const plan: RenderPlan = {
      source: short,
      keep: [{ startMs: 0, endMs: 6_000 }],
      facts: {
        width: 360,
        height: 640,
        durationMs: 6_000,
        fps: 25,
        hdrTransfer: null,
        hasAudio: false,
      },
      work,
      output: join(work, "short-out.mp4"),
      background: { imagePath: image, keyColor: "#00b140" },
      timeoutMs: 60_000,
      credit: { pngPath: resolve(process.cwd(), CREDIT_PNG_PATH), timeoutMs: 60_000 },
    };
    await encodeRender(plan, true, {});
    const gateInput = {
      output: plan.output,
      imagePath: image,
      width: 360,
      height: 640,
      durationMs: 6_000,
    };
    expect(creditStartSeconds(plan)).toBe(3);
    expect(await outputIsOnlyBackground({ ...gateInput, creditStartSeconds: 3 })).toBe(false);
    expect(await outputIsOnlyBackground(gateInput)).toBe(true);
  });
});
