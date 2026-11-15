import { test } from "@playwright/test";
import { cleanups } from "./fixtures/background-picker";
import { registerPicker } from "./background-picker-parts/picker";
import { registerUpload } from "./background-picker-parts/upload";
import { registerDelete } from "./background-picker-parts/delete";

// Built in studios belong to nobody, so every test here sees every other test's studios. They
// run one after another in this file so the seeded studios never overlap.
test.describe.configure({ mode: "serial", timeout: 90_000 });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

registerPicker();
registerUpload();
registerDelete();
