import { FlattenMap, encodedMappings } from "@jridgewell/trace-mapping";

/**
 * Prepares one Next server chunk's source map for the Worker bundle (spec 0005, AC-6).
 * Turbopack writes sectioned (index) maps that esbuild does not compose, and OpenNext's traced
 * copy of `.next` leaves `.map` files behind. So each map is flattened to a plain map and put
 * inside its chunk as a data URI, where it travels with the code through every bundling step.
 */

export type MapResult =
  { readonly ok: true; readonly data: string } | { readonly ok: false; readonly error: string };

/** Lines the Sentry plugin adds above a chunk's code (debug ID, release); each starts like this. */
const INJECTED_LINE = ";!function(){try";

/**
 * A plain (version 3, one `mappings` string) map equal to `raw`, which may be sectioned, and
 * lined up with `js`. The plugin adds lines above the code after Turbopack wrote the map and
 * does not move a sectioned map's mappings by all of them, so every mapping would sit a line
 * too early. The first mapping belongs on the first line of real code: shift to match.
 */
export function flattenSourceMap(raw: string, js: string): MapResult {
  try {
    const flat = new FlattenMap(JSON.parse(raw));
    const mappings = encodedMappings(flat);
    const codeStart = js.split("\n").findIndex((line) => !line.startsWith(INJECTED_LINE));
    const firstMapped = mappings.split(";").findIndex((group) => group !== "");
    const shift = codeStart > firstMapped && firstMapped >= 0 ? codeStart - firstMapped : 0;
    return {
      ok: true,
      data: JSON.stringify({
        version: 3,
        sources: flat.sources,
        names: flat.names,
        mappings: ";".repeat(shift) + mappings,
      }),
    };
  } catch {
    return { ok: false, error: "The source map could not be read." };
  }
}

const REFERENCE = /^\/\/# sourceMappingURL=(?!data:)(\S+\.map)[ \t]*$/m;

/** The map file name a chunk points to, or null when it has none (or already inlines it). */
export function mapReference(js: string): string | null {
  return REFERENCE.exec(js)?.[1] ?? null;
}

/** `js` with its `//# sourceMappingURL=<file>.map` line replaced by the map as a data URI. */
export function inlineSourceMap(js: string, flatMapJson: string): string {
  const uri = `data:application/json;base64,${Buffer.from(flatMapJson).toString("base64")}`;
  return js.replace(REFERENCE, `//# sourceMappingURL=${uri}`);
}
