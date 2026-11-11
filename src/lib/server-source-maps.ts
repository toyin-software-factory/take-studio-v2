import { FlattenMap, TraceMap, decodedMappings, encodedMappings } from "@jridgewell/trace-mapping";

/**
 * Prepares one Next server chunk's source map for the Worker bundle (spec 0005, AC-6).
 * Turbopack writes sectioned (index) maps that esbuild does not compose, and OpenNext's traced
 * copy of `.next` leaves `.map` files behind. So each map is flattened to a plain map and put
 * inside its chunk as a data URI, where it travels with the code through every bundling step.
 */

export type MapResult =
  { readonly ok: true; readonly data: string } | { readonly ok: false; readonly error: string };

/** Markers of the lines the Sentry plugin adds above a chunk (debug ID, release). */
const SENTRY_LINE = /_sentryDebugIds|_sentryRelease|SENTRY_RELEASES?\b/;

/** How many lines at the top of `js` the Sentry plugin added. Next's own `_debugIds` line is not one. */
function sentryLineCount(lines: readonly string[]): number {
  const firstOther = lines.findIndex((line) => !SENTRY_LINE.test(line));
  return firstOther === -1 ? lines.length : firstOther;
}

type Decoded = readonly (readonly (readonly number[])[])[];

/**
 * How many mappings land past the end of their line, or on a line that is not code, when the
 * map is moved down by `shift`. Trailing `//#` comment lines are not code.
 */
function misfits(decoded: Decoded, lines: readonly string[], shift: number): number {
  const codeLines = lines.length - [...lines].reverse().findIndex((l) => !l.startsWith("//#"));
  return decoded.reduce(
    (count, segments, index) =>
      count +
      segments.filter(
        (segment) =>
          index + shift >= codeLines || segment[0]! > (lines[index + shift]?.length ?? -1),
      ).length,
    0,
  );
}

/**
 * Is the map lined up with the chunk? Turbopack puts a few segments a few columns past the end
 * of a line, so zero misfits is too strict; instead the chosen shift must leave at most 10% of
 * the mappings off, and at least 5 times fewer than the shift one line higher or lower (a wrong
 * shift leaves most of them off, so this comparison is what catches it).
 */
function fits(decoded: Decoded, lines: readonly string[], shift: number): boolean {
  const total = decoded.reduce((sum, segments) => sum + segments.length, 0);
  if (total === 0) return true;
  const own = misfits(decoded, lines, shift);
  if (own === 0) return true;
  if (own / total > 0.1) return false;
  return [shift - 1, shift + 1]
    .filter((other) => other >= 0)
    .every((other) => misfits(decoded, lines, other) >= own * 5);
}

/**
 * A plain (version 3, one `mappings` string) map equal to `raw`, which may be sectioned, and
 * lined up with `js`. Turbopack's section offset already counts its own `_debugIds` line, but
 * the Sentry plugin adds lines above the chunk afterwards and does not move the mappings of a
 * sectioned map, so those must move down by exactly the number of lines the plugin added. The result is checked
 * against the chunk (every mapping must land on a real line and column); a map that does not
 * fit is refused, because a wrong line is worse than none.
 */
export function flattenSourceMap(raw: string, js: string): MapResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    const flat = new FlattenMap(parsed as never);
    const lines = js.split("\n");
    // Only a sectioned map is left unmoved by the plugin; a plain map it adjusts itself.
    const sectioned = typeof parsed === "object" && parsed !== null && "sections" in parsed;
    const shift = sectioned ? sentryLineCount(lines) : 0;
    const unshifted = encodedMappings(flat);
    const decoded = decodedMappings(
      new TraceMap({ version: 3, sources: [], names: [], mappings: unshifted }),
    );
    if (!fits(decoded, lines, shift)) {
      return { ok: false, error: "The source map does not fit the chunk." };
    }
    const mappings = ";".repeat(shift) + unshifted;
    return {
      ok: true,
      data: JSON.stringify({ version: 3, sources: flat.sources, names: flat.names, mappings }),
    };
  } catch {
    return { ok: false, error: "The source map could not be read." };
  }
}

const REFERENCE = /^\/\/# sourceMappingURL=(?!data:)(\S+\.map)[ \t]*$/m;

/** Does `js` already carry its map inline (a `//# sourceMappingURL=data:` line)? */
export function hasInlinedMap(js: string): boolean {
  return /^\/\/# sourceMappingURL=data:/m.test(js);
}

/**
 * The map file name a chunk points to, or null when it has none (or already inlines it). The
 * reference is a URL, so a chunk named `[id]` points at `%5Bid%5D`: it is decoded to the real
 * file name. A reference that cannot be decoded gives the raw text, so the file is not found
 * and the caller reports it.
 */
export function mapReference(js: string): string | null {
  const reference = REFERENCE.exec(js)?.[1];
  if (reference === undefined) return null;
  try {
    return decodeURIComponent(reference);
  } catch {
    return reference;
  }
}

/** `js` with its `//# sourceMappingURL=<file>.map` line replaced by the map as a data URI. */
export function inlineSourceMap(js: string, flatMapJson: string): string {
  const uri = `data:application/json;base64,${Buffer.from(flatMapJson).toString("base64")}`;
  return js.replace(REFERENCE, `//# sourceMappingURL=${uri}`);
}
