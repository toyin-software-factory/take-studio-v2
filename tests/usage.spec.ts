import { test } from "@playwright/test";
import { cleanups } from "./fixtures/usage";
import { registerStates } from "./usage-parts/states";
import { registerRecord } from "./usage-parts/record";

// Every test writes the same global usage settings, so the whole file runs on one worker in order.
test.describe.configure({ mode: "serial" });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

// Chromium's fake camera and microphone for the /record tests below (a worker option, so it
// sits at the top of the file, not inside a describe).
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

registerStates();
registerRecord();
