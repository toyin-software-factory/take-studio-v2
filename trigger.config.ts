import { defineConfig } from "@trigger.dev/sdk";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { additionalFiles, type ffmpeg, syncEnvVars } from "@trigger.dev/build/extensions/core";

// Sentry (spec 0005): source maps are uploaded on deploy only when CI has a token
// (deploy.yml), then deleted from the image; the deploy also tells the jobs their Sentry
// environment and release (the git commit SHA). The plugin is loaded only in that branch:
// importing it at the top breaks the `trigger dev` config build on machines without the token.
const sentryUpload = process.env.SENTRY_AUTH_TOKEN
  ? [
      esbuildPlugin(
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, see above
        require("@sentry/esbuild-plugin").sentryEsbuildPlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          telemetry: false,
          release: { name: process.env.SENTRY_RELEASE },
          sourcemaps: { filesToDeleteAfterUpload: ["**/*.map"] },
        }),
        { placement: "last", target: "deploy" },
      ),
    ]
  : [];

type BuildExtension = ReturnType<typeof ffmpeg>;

/**
 * A pinned, tagged ffmpeg 7.1 static build (spec 0004 build plan step 2), instead of the
 * built in `ffmpeg()` extension, which always installs the moving johnvansickle git snapshot.
 * BtbN's GPL static build: libx264, libx265, libzimg (zscale), tonemap, silencedetect.
 * The tarball is verified against its SHA-256 before install. To upgrade: pick a newer
 * monthly `autobuild-*` release on github.com/BtbN/FFmpeg-Builds, update both constants,
 * and prove it on a preview branch.
 */
const FFMPEG_BUILD = {
  url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2025-09-30-13-19/ffmpeg-n7.1.2-5-g8f77695e65-linux64-gpl-7.1.tar.xz",
  sha256: "49df247d3908323bf1d99c00480fed8603506cc0cb2a10ad8f905a961c3ceab8",
} as const;

function pinnedFfmpeg(): BuildExtension {
  return {
    name: "pinned-ffmpeg",
    onBuildComplete(context) {
      // Dev runs use the machine's own ffmpeg (FFMPEG_PATH unset falls back to "ffmpeg").
      if (context.target === "dev") return;
      context.addLayer({
        id: "pinned-ffmpeg",
        image: {
          instructions: [
            "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils && " +
              `curl -fsSL -o /tmp/ffmpeg.tar.xz ${FFMPEG_BUILD.url} && ` +
              `echo "${FFMPEG_BUILD.sha256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - && ` +
              "tar -xJf /tmp/ffmpeg.tar.xz -C /usr/local/bin --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' && " +
              "rm /tmp/ffmpeg.tar.xz && apt-get clean && rm -rf /var/lib/apt/lists/*",
          ],
        },
        deploy: {
          env: { FFMPEG_PATH: "/usr/local/bin/ffmpeg", FFPROBE_PATH: "/usr/local/bin/ffprobe" },
          override: true,
        },
      });
    },
  };
}

export default defineConfig({
  // Not a secret (spec 0001): the project ref lives here, not in env or CI.
  project: "proj_myruzrkdrkciyulujiba",
  runtime: "node-22",
  dirs: ["./src/trigger"],
  tsconfig: "./tsconfig.json",
  // Video jobs need room for a 2 GB input plus output on local disk (spec 0001).
  machine: "medium-1x",
  // 30 minutes of compute per run. Long enough for a 10 minute 1080p take.
  maxDuration: 1800,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 2_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      // Pinned ffmpeg 7.1 (spec 0004), not the built in moving snapshot.
      pinnedFfmpeg(),
      // The built in studio images (spec 0008): the cleanup task installs them from here.
      additionalFiles({ files: ["./assets/backgrounds/*"] }),
      // TEMPORARY (B-T18, C-15): the clip the `ai-measure` task times; removed with the task.
      additionalFiles({ files: ["./tests/fixtures/media/speech-en.mp4"] }),
      syncEnvVars(
        ({ environment }) => [
          { name: "SENTRY_ENVIRONMENT", value: environment === "prod" ? "production" : "preview" },
          ...(process.env.SENTRY_RELEASE
            ? [{ name: "SENTRY_RELEASE", value: process.env.SENTRY_RELEASE }]
            : []),
        ],
        { override: true },
      ),
      ...sentryUpload,
    ],
  },
});
