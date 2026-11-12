import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isVideoExpired } from "./video-expiry";

const now = new Date("2026-12-01T12:00:00Z");

describe("isVideoExpired", () => {
  it("is false when no expiry is set (the upload has not completed)", () => {
    expect(isVideoExpired(null, now)).toBe(false);
  });

  it("is false before the expiry, true at it (equal counts as expired) and after it", () => {
    expect(isVideoExpired(new Date("2026-12-01T12:00:01Z"), now)).toBe(false);
    expect(isVideoExpired(new Date("2026-12-01T12:00:00Z"), now)).toBe(true);
    expect(isVideoExpired(new Date("2026-12-01T11:59:59Z"), now)).toBe(true);
  });

  it("takes an ISO string like the browser has, with the same answers", () => {
    expect(isVideoExpired("2026-12-01T12:00:01.000Z", now)).toBe(false);
    expect(isVideoExpired("2026-12-01T12:00:00.000Z", now)).toBe(true);
    expect(isVideoExpired("2026-11-01T00:00:00.000Z", now)).toBe(true);
  });
});

/** Every non test source file under src. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("one function per rule (HRF-T07)", () => {
  it("has no hand written expiry comparison outside isVideoExpired", () => {
    const offenders = sources("src").filter((file) => {
      if (file.endsWith("video-expiry.ts")) return false;
      // `videoExpiresAt ... .getTime() <= now` (or <, >, >=) written out by hand.
      return /videoExpiresAt[^\n]*getTime\(\)\s*[<>]=?\s*now/.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("keeps one set of the media failure codes, in failure-codes.ts", () => {
    // A `new Set([...])` that lists the media codes, outside the registry. (A message per code,
    // as in take-messages.ts, is not a second set.)
    const own = sources("src").filter((file) => {
      if (file.endsWith("failure-codes.ts")) return false;
      return /new Set\(\[[^\]]*corrupt_upload[^\]]*upload_abandoned/.test(
        readFileSync(file, "utf8"),
      );
    });
    expect(own).toEqual([]);
  });
});
