import { spawnSync } from "node:child_process";
import { describe, it } from "vitest";

/**
 * The guard for suites that need the real ffmpeg and ffprobe (with libwebp). On a developer's
 * machine without them a suite is skipped, with a note in the output. In CI (`CI` is set) a
 * missing tool is a failure, so a green run always means these suites really ran: CI installs
 * the same pinned BtbN build the jobs use (`ci.yml`, "Install the pinned ffmpeg").
 */
export type FfmpegCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Looks for ffmpeg with the libwebp encoder and for ffprobe on the PATH. */
export function checkFfmpeg(): FfmpegCheck {
  const ffmpeg = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (ffmpeg.error || ffmpeg.status !== 0) return { ok: false, reason: "ffmpeg was not found" };
  if (!ffmpeg.stdout.includes("libwebp")) {
    return { ok: false, reason: "ffmpeg has no libwebp encoder" };
  }
  const ffprobe = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
  if (ffprobe.error || ffprobe.status !== 0) return { ok: false, reason: "ffprobe was not found" };
  return { ok: true };
}

/** Whether this run is CI (GitHub Actions and most CI systems set `CI=true`). */
export function inCi(env: Record<string, string | undefined> = process.env): boolean {
  return env.CI !== undefined && env.CI !== "" && env.CI !== "false" && env.CI !== "0";
}

/**
 * What a suite does with the result: `run` when the tools are there, `fail` (CI, with the
 * message to show) or `skip` (a local run, with the note to print) when they are not.
 */
export function ffmpegPlan(
  check: FfmpegCheck,
  ci: boolean,
  suite: string,
): { readonly kind: "run" } | { readonly kind: "fail" | "skip"; readonly message: string } {
  if (check.ok) return { kind: "run" };
  if (ci) {
    return {
      kind: "fail",
      message:
        `${suite}: ${check.reason}, and CI must run this suite (CI is set). ` +
        "Install the pinned BtbN ffmpeg and ffprobe build (see the ci.yml step " +
        '"Install the pinned ffmpeg" and trigger.config.ts) so they are on the PATH.',
    };
  }
  return {
    kind: "skip",
    message: `${suite} SKIPPED: ${check.reason}. CI runs it with the pinned ffmpeg; install ffmpeg with libwebp and ffprobe to run it here.`,
  };
}

/**
 * Per test limit for suites that run the real tools. Vitest's 5 s default is too tight for a
 * loaded CI runner (a real ffmpeg seek test took longer and failed `main`), so every such test
 * gets 30 s.
 */
export const REAL_FFMPEG_TEST_TIMEOUT_MS = 30_000;

/**
 * Registers `body` as a suite named `name` that runs only with the real tools. Without them:
 * in CI one failing test says why; locally the suite is skipped and a note is printed.
 */
export function describeWithFfmpeg(name: string, body: () => void): void {
  const plan = ffmpegPlan(checkFfmpeg(), inCi(), name);
  if (plan.kind === "run") {
    describe(name, { timeout: REAL_FFMPEG_TEST_TIMEOUT_MS }, body);
  } else if (plan.kind === "fail") {
    describe(name, () => {
      it("needs ffmpeg and ffprobe, which CI installs", () => {
        throw new Error(plan.message);
      });
    });
  } else {
    console.warn(plan.message);
    describe.skip(name, body);
  }
}
