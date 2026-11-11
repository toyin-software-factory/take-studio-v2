import { readFileSync } from "node:fs";
import { TraceMap, decodedMappings, originalPositionFor } from "@jridgewell/trace-mapping";
import { describe, expect, it } from "vitest";
import {
  flattenSourceMap,
  hasInlinedMap,
  inlineSourceMap,
  mapReference,
} from "./server-source-maps";

/** A section's map: one segment at column 4 of its first line, pointing at `route.ts` 1:0. */
const section = {
  version: 3,
  sources: ["../../../src/app/api/x/route.ts"],
  names: [],
  mappings: "IAAA",
};
const sectioned = JSON.stringify({
  version: 3,
  sections: [{ offset: { line: 1, column: 0 }, map: section }],
});

/** The line the Sentry plugin adds, and the one Turbopack adds (its offset already counts it). */
const SENTRY_LINE = ";!function(){try{var e=1;e._sentryDebugIds={}}catch(e){}}();";
const TURBOPACK_LINE = ";!function(){try{var e=1;e._debugIds={}}catch(e){}}();";
const CODE = "module.exports=[1,e=>{return 42}];";

const firstMappedLine = (map: object) =>
  decodedMappings(new TraceMap(map as never)).findIndex((segments) => segments.length > 0);

describe("flattenSourceMap", () => {
  it("flattens a sectioned map into a plain one", () => {
    const flat = flattenSourceMap(sectioned, `${TURBOPACK_LINE}\n${CODE}\n`);
    expect(flat.ok).toBe(true);
    const map = JSON.parse(flat.ok ? flat.data : "{}");
    expect(map.version).toBe(3);
    expect(map.sections).toBeUndefined();
    expect(map.sources).toEqual(["../../../src/app/api/x/route.ts"]);
  });

  it("moves the mappings down by the lines the Sentry plugin added, and no more", () => {
    // Section offset 1 counts the Turbopack line; the Sentry line above it is the extra one.
    const withSentry = flattenSourceMap(sectioned, `${SENTRY_LINE}\n${TURBOPACK_LINE}\n${CODE}\n`);
    expect(firstMappedLine(JSON.parse(withSentry.ok ? withSentry.data : "{}"))).toBe(2);
    const without = flattenSourceMap(sectioned, `${TURBOPACK_LINE}\n${CODE}\n`);
    expect(firstMappedLine(JSON.parse(without.ok ? without.data : "{}"))).toBe(1);
  });

  it("refuses a map that does not fit the chunk (a wrong line is worse than none)", () => {
    // A map whose column is far past the end of the line it would land on.
    const farColumn = JSON.stringify({
      version: 3,
      sections: [{ offset: { line: 1, column: 0 }, map: { ...section, mappings: "+/cAAA" } }],
    });
    expect(flattenSourceMap(farColumn, `${TURBOPACK_LINE}\nx;\n`)).toEqual({
      ok: false,
      error: "The source map does not fit the chunk.",
    });
  });

  it("refuses something that is not a source map", () => {
    expect(flattenSourceMap("not json", "code();")).toMatchObject({ ok: false });
  });

  describe("with a real Turbopack chunk and map (the /api/sentry-check route)", () => {
    const read = (name: string) =>
      readFileSync(new URL(`./fixtures/turbopack/${name}`, import.meta.url), "utf8");
    const chunk = read("sentry-check-chunk.js.fixture");
    const raw = read("sentry-check-chunk.js.map.fixture");

    it("lines the map up so the throw resolves to its line in route.ts", () => {
      const flat = flattenSourceMap(raw, chunk);
      expect(flat.ok).toBe(true);
      const trace = new TraceMap(JSON.parse(flat.ok ? flat.data : "{}"));
      const lines = chunk.split("\n");
      const line = lines.findIndex((l) => l.includes("Sentry check: deliberate server error"));
      const column = lines[line]!.indexOf("Sentry check: deliberate server error");
      const original = originalPositionFor(trace, { line: line + 1, column });
      expect(original.source).toMatch(/src\/app\/api\/sentry-check\/route\.ts$/);
      // The `throw` is on line 18 of that file.
      expect(original.line).toBe(18);
    });

    it("is refused when the Sentry line is missing from the chunk", () => {
      // Without the line the plugin added, the map would be applied one line too high.
      const withoutSentryLine = chunk.split("\n").slice(1).join("\n");
      const flat = flattenSourceMap(raw, withoutSentryLine);
      if (flat.ok) {
        const trace = new TraceMap(JSON.parse(flat.data));
        const lines = withoutSentryLine.split("\n");
        const line = lines.findIndex((l) => l.includes("Sentry check: deliberate server error"));
        const column = lines[line]!.indexOf("Sentry check: deliberate server error");
        // Nothing may claim a wrong line: either no mapping, or still line 18.
        const original = originalPositionFor(trace, { line: line + 1, column });
        expect(original.line === null || original.line === 18).toBe(true);
      } else {
        expect(flat.error).toMatch(/does not fit/);
      }
    });
  });
});

describe("inlineSourceMap, mapReference and hasInlinedMap", () => {
  const js = "code();\n//# sourceMappingURL=chunk.js.map\n";

  it("finds the map file a chunk points to", () => {
    expect(mapReference(js)).toBe("chunk.js.map");
    expect(mapReference("code();")).toBeNull();
  });

  it("replaces the reference with the map as a data URI", () => {
    const out = inlineSourceMap(js, '{"version":3}');
    expect(out).toContain(
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from('{"version":3}').toString("base64")}`,
    );
    expect(out).not.toContain("chunk.js.map");
  });

  it("decodes the reference, so a chunk named [id] finds its map file", () => {
    expect(mapReference("code();\n//# sourceMappingURL=route_%5Bid%5D_actions.js.map\n")).toBe(
      "route_[id]_actions.js.map",
    );
    expect(mapReference("code();\n//# sourceMappingURL=plain.js.map\n")).toBe("plain.js.map");
  });

  it("does not look at a map that is already inlined", () => {
    expect(mapReference(inlineSourceMap(js, "{}"))).toBeNull();
  });

  it("tells an inlined map from a reference, and ignores the text inside a string", () => {
    expect(hasInlinedMap(inlineSourceMap(js, "{}"))).toBe(true);
    expect(hasInlinedMap(js)).toBe(false);
    expect(hasInlinedMap('const s = "//# sourceMappingURL=data:x";\n')).toBe(false);
  });
});
