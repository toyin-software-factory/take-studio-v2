import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";

// Not a secret (spec 0001). Read from TRIGGER_PROJECT_REF until the real ref is written here.
const project = process.env.TRIGGER_PROJECT_REF;
if (!project) {
  throw new Error("TRIGGER_PROJECT_REF is not set. Add it to .env (local) or the deploy workflow.");
}

export default defineConfig({
  project,
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
    extensions: [ffmpeg({ version: "7" })],
  },
});
