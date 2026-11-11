/**
 * Adds the winning debug ID snippet to a bundle (see src/lib/sentry-debug-id.ts).
 * Usage: tsx scripts/sentry-debug-id.ts <bundle.js>   (run after `sentry-cli sourcemaps inject`)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { withWinningDebugId } from "../src/lib/sentry-debug-id";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/sentry-debug-id.ts <bundle.js>");
  process.exit(2);
}
const result = withWinningDebugId(readFileSync(file, "utf8"));
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
writeFileSync(file, result.data);
