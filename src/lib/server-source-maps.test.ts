import { describe, expect, it } from "vitest";
import { TraceMap, decodedMappings } from "@jridgewell/trace-mapping";
import { flattenSourceMap, inlineSourceMap, mapReference } from "./server-source-maps";

/** A section's map: one segment on its first line, pointing at `route.ts` 1:0. */
const section = {
  version: 3,
  sources: ["../../../src/app/api/x/route.ts"],
  names: [],
  mappings: "AAAA",
};
const sectioned = JSON.stringify({
  version: 3,
  sections: [{ offset: { line: 1, column: 0 }, map: section }],
});
const firstMappedLine = (map: object) =>
  decodedMappings(new TraceMap(map as never)).findIndex((segments) => segments.length > 0);
const INJECTED = ";!function(){try{var e=1}catch(e){}}();";

describe("flattenSourceMap", () => {
  it("flattens a sectioned map into a plain one", () => {
    const flat = flattenSourceMap(sectioned, `${INJECTED}\ncode();\n`);
    expect(flat.ok).toBe(true);
    const map = JSON.parse(flat.ok ? flat.data : "{}");
    expect(map.version).toBe(3);
    expect(map.sections).toBeUndefined();
    expect(map.sources).toEqual(["../../../src/app/api/x/route.ts"]);
  });

  it("puts the first mapping on the first line of real code, past every injected line", () => {
    const js = `${INJECTED}\n${INJECTED}\ncode();\n`;
    const flat = flattenSourceMap(sectioned, js);
    const map = JSON.parse(flat.ok ? flat.data : "{}");
    // The section starts at line 1, so alone it would map line 2 (index 1); the code is on
    // line 3 (index 2).
    expect(firstMappedLine(map)).toBe(2);
  });

  it("changes nothing when the map already starts on the first code line", () => {
    const flat = flattenSourceMap(sectioned, "header();\ncode();\n");
    const map = JSON.parse(flat.ok ? flat.data : "{}");
    expect(firstMappedLine(map)).toBe(1);
  });

  it("refuses something that is not a source map", () => {
    expect(flattenSourceMap("not json", "code();")).toMatchObject({ ok: false });
  });
});

describe("inlineSourceMap and mapReference", () => {
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

  it("does not look at a map that is already inlined", () => {
    expect(mapReference(inlineSourceMap(js, "{}"))).toBeNull();
  });
});
