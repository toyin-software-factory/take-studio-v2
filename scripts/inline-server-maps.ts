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
import {
  flattenSourceMap,
  hasInlinedMap,
  inlineSourceMap,
  mapReference,
} from "../src/lib/server-source-maps";

if (!process.env.WORKER_SOURCE_MAPS) process.exit(0);

const next = process.argv[2] ?? ".next";
const root = join(next, "server");
const standalone = join(next, "standalone", ".next", "server");
const chunks = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) =>
  /\.(?:js|mjs|cjs)$/.test(f),
);

let inlined = 0;
let failed = 0;
for (const chunk of chunks) {
  const file = join(root, chunk);
  const js = readFileSync(file, "utf8");
  const reference = mapReference(js);
  if (!reference) continue;
  const mapFile = join(dirname(file), reference);
  if (!existsSync(mapFile)) {
    // A chunk that points at a map that is not there would ship unmapped: report it.
    failed += 1;
    console.error(`${chunk}: the map file it points to (${reference}) is missing.`);
    continue;
  }
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
  if (existsSync(twin) && hasInlinedMap(readFileSync(file, "utf8"))) {
    copyFileSync(file, twin);
    mirrored += 1;
  }
}
// With the flag set the deploy relies on these maps, so nothing inlined (a framework change) or
// any failure stops the build instead of quietly giving unmapped traces.
const carrying = chunks.filter((chunk) =>
  hasInlinedMap(readFileSync(join(root, chunk), "utf8")),
).length;
console.log(
  `Inlined ${inlined} server source maps (${failed} failed); ${carrying} chunks carry one; mirrored ${mirrored}.`,
);
if (failed > 0 || carrying === 0) {
  console.error(
    failed > 0
      ? "Some server source maps could not be inlined."
      : "No server chunk carries a source map: Next wrote none, or its output changed.",
  );
  process.exit(1);
}
