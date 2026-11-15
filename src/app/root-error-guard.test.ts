import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { shouldThrowRootError } from "@/lib/root-error-check";
import { isGalleryEnabled } from "./design/gallery";

// B2-T155: the root layout's test only trigger is impossible to hit in production.
const withHeader = async () => new Headers({ "x-root-error-check": "1" });

describe("the root layout trigger in production", () => {
  it("is off for the live Worker's environment (no DESIGN_GALLERY, production)", async () => {
    const read = vi.fn(withHeader);
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "production", DESIGN_GALLERY: undefined },
      { NODE_ENV: "production", DESIGN_GALLERY: "0" },
      { NODE_ENV: "test" },
    ]) {
      expect(await shouldThrowRootError(isGalleryEnabled(env), read)).toBe(false);
    }
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the not found page", () => {
  it("renders per request, so the gallery build's header read cannot turn a 404 into a 500", () => {
    const source = readFileSync(new URL("./not-found.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/await connection\(\)/);
  });
});
