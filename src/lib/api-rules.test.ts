import { describe, expect, it } from "vitest";
import {
  API_KEYS,
  API_KEY_LENGTH,
  API_RATE,
  apiKeyPrefix,
  bearerKey,
  generateApiKey,
  hashApiKey,
  isOverRateLimit,
  normalizeKeyName,
  parseApiKey,
  rateWindowStart,
  retryAfterSeconds,
} from "./api-rules";

const FIXED = generateApiKey(new Uint8Array(32).fill(7));

describe("key format (AC-2)", () => {
  it("is tsk_ plus 43 base64url characters, 47 in all, and round trips through parse", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^tsk_[A-Za-z0-9_-]{43}$/);
    expect(key).toHaveLength(47);
    expect(API_KEY_LENGTH).toBe(47);
    expect(parseApiKey(key)).toBe(key);
  });

  it("makes a different key every time", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateApiKey())).size).toBe(50);
  });

  it("is deterministic for given bytes and uses url safe characters only", () => {
    expect(generateApiKey(new Uint8Array(32).fill(7))).toBe(FIXED);
    expect(generateApiKey(new Uint8Array(32).fill(251))).not.toMatch(/[+/=]/);
  });

  it("refuses bytes of the wrong length", () => {
    expect(() => generateApiKey(new Uint8Array(16))).toThrow();
  });

  it("parse rejects malformed keys", () => {
    for (const bad of [
      "",
      "tsk_",
      FIXED.slice(0, -1),
      `${FIXED}x`,
      FIXED.replace("tsk_", "sk__"),
      FIXED.replace("tsk_", "TSK_"),
      `${FIXED.slice(0, -1)}+`,
      ` ${FIXED}`,
      `${FIXED}\n`,
    ]) {
      expect(parseApiKey(bad)).toBeNull();
    }
  });
});

describe("prefix (AC-2)", () => {
  it("is the first 8 characters after tsk_ and empty for a malformed key", () => {
    expect(apiKeyPrefix(FIXED)).toBe(FIXED.slice(4, 12));
    expect(apiKeyPrefix(FIXED)).toHaveLength(8);
    expect(apiKeyPrefix("nope")).toBe("");
  });
});

describe("hash (AC-2)", () => {
  it("is deterministic SHA-256 hex and never the raw key", async () => {
    const a = await hashApiKey(FIXED);
    expect(a).toBe(await hashApiKey(FIXED));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain(FIXED.slice(4));
    expect(await hashApiKey(generateApiKey())).not.toBe(a);
  });

  it("matches a known SHA-256 value", async () => {
    expect(await hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("bearer header (AC-5)", () => {
  it("returns the key for Bearer and a well formed key", () => {
    expect(bearerKey(`Bearer ${FIXED}`)).toBe(FIXED);
  });

  it("returns null for another scheme, an empty value, a malformed key or extra parts", () => {
    for (const bad of [
      "",
      "Bearer",
      "Bearer ",
      `Basic ${FIXED}`,
      `bearer ${FIXED}`,
      "Bearer tsk_short",
      `Bearer ${FIXED} extra`,
      FIXED,
    ]) {
      expect(bearerKey(bad)).toBeNull();
    }
  });
});

describe("key name (AC-1)", () => {
  it("trims, and accepts 1 to 60 characters only", () => {
    expect(normalizeKeyName("  my agent ")).toBe("my agent");
    expect(normalizeKeyName("a".repeat(60))).toBe("a".repeat(60));
    expect(normalizeKeyName("a".repeat(61))).toBeNull();
    expect(normalizeKeyName("   ")).toBeNull();
    expect(normalizeKeyName("")).toBeNull();
  });
});

describe("limits (AC-9)", () => {
  it("has the spec numbers", () => {
    expect(API_KEYS.maxPerCreator).toBe(5);
    expect(API_RATE.perMinute).toBe(120);
  });

  it("the 120th request passes and the 121st is over", () => {
    expect(isOverRateLimit(120)).toBe(false);
    expect(isOverRateLimit(121)).toBe(true);
  });

  it("windows start on the UTC minute", () => {
    expect(rateWindowStart(new Date("2026-11-14T10:05:42.500Z")).toISOString()).toBe(
      "2026-11-14T10:05:00.000Z",
    );
  });

  it("Retry-After is 60 minus the seconds into the minute, at least 1", () => {
    expect(retryAfterSeconds(new Date("2026-11-14T10:05:00Z"))).toBe(60);
    expect(retryAfterSeconds(new Date("2026-11-14T10:05:42Z"))).toBe(18);
    expect(retryAfterSeconds(new Date("2026-11-14T10:05:59Z"))).toBe(1);
  });
});
