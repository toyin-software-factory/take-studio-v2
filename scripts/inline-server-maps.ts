/**
 * Inlines the Next server source maps into their chunks (see src/lib/server-source-maps.ts).
 * Runs after `next build`, only when WORKER_SOURCE_MAPS is set (the deploy sets it).
 * OpenNext bundles from Next's standalone output, a separate copy of the chunks, so each
 * inlined chunk is copied over its twin there too.
 * Usage: tsx scripts/inline-server-maps.ts [.next]
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { flattenSourceMap, inlineSourceMap, mapReference } from "../src/lib/server-source-maps";

if (!process.env.WORKER_SOURCE_MAPS) process.exit(0);

const next = process.argv[2] ?? ".next";
const root = join(next, "server");
const standalone = join(next, "standalone", ".next", "server");
const chunks = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) =>
  f.endsWith(".js"),
);

let inlined = 0;
let failed = 0;
for (const chunk of chunks) {
  const file = join(root, chunk);
  const js = readFileSync(file, "utf8");
  const reference = mapReference(js);
  if (!reference) continue;
  const mapFile = join(dirname(file), reference);
  if (!existsSync(mapFile)) continue;
  const flat = flattenSourceMap(readFileSync(mapFile, "utf8"), js);
  if (!flat.ok) {
    failed += 1;
    console.error(`${chunk}: ${flat.error}`);
    continue;
  }
  const withMap = inlineSourceMap(js, flat.data);
  writeFileSync(file, withMap);
  rmSync(mapFile);
  inlined += 1;
}

// Every chunk that carries its map now, whether inlined just now or on an earlier run.
let mirrored = 0;
for (const chunk of chunks) {
  const twin = join(standalone, chunk);
  const file = join(root, chunk);
  if (existsSync(twin) && readFileSync(file, "utf8").includes("sourceMappingURL=data:")) {
    copyFileSync(file, twin);
    mirrored += 1;
  }
}
console.log(`Inlined ${inlined} server source maps (${failed} failed), mirrored ${mirrored}.`);
if (failed > 0) process.exit(1);
