/**
 * Writes the deploy config for the built Worker bundle (see src/lib/worker-deploy-config.ts).
 * Usage: tsx scripts/worker-deploy-config.ts <bundle folder>   (reads ./wrangler.jsonc)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { builtWorkerConfig } from "../src/lib/worker-deploy-config";

const folder = process.argv[2];
if (!folder) {
  console.error("usage: tsx scripts/worker-deploy-config.ts <bundle folder>");
  process.exit(2);
}

// wrangler.jsonc has comments and trailing commas; TypeScript's JSON reader accepts both.
const { config, error } = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
);
if (error) {
  console.error("Could not read wrangler.jsonc.");
  process.exit(1);
}

const result = builtWorkerConfig(config);
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
writeFileSync(join(folder, "wrangler.json"), `${JSON.stringify(result.data, null, 2)}\n`);
