import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Only the launch gate (`pnpm test:legal-launch`); the normal config never includes it. */
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: {
    include: ["tests/legal-launch/*.check.ts"],
    environment: "node",
  },
});
