import { test } from "@playwright/test";
import { cleanups } from "./fixtures/record-a11y";
import { registerAxe } from "./record-a11y-parts/axe";
import { registerKeyboard } from "./record-a11y-parts/keyboard";

test.describe.configure({ timeout: 120_000, mode: "serial" });

test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

registerAxe();
registerKeyboard();
