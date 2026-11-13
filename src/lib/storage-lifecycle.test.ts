import { describe, expect, it } from "vitest";
import {
  ABORT_INCOMPLETE_DAYS,
  BACKSTOP_DAYS,
  LIFECYCLE_PREFIXES,
  lifecycleRules,
} from "./storage-lifecycle";
import { VIDEO_RETENTION_DAYS } from "./take-rules";

/** Spec 0013, AC-9: the bucket rules are a backstop, never earlier than the promise. */
describe("lifecycleRules", () => {
  const { rules } = lifecycleRules();

  it("keeps the backstop later than the 30 day promise and the abort window short", () => {
    expect(BACKSTOP_DAYS).toBeGreaterThan(VIDEO_RETENTION_DAYS);
    expect(ABORT_INCOMPLETE_DAYS).toBeLessThan(BACKSTOP_DAYS);
  });

  it("covers originals, renders and previews, once each", () => {
    expect(rules.map((r) => r.conditions.prefix).sort()).toEqual([
      "originals/",
      "previews/",
      "renders/",
    ]);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  it("never lets a rule match backgrounds/ or the whole bucket", () => {
    for (const prefix of LIFECYCLE_PREFIXES) {
      expect(prefix).toMatch(/^[a-z]+\/$/);
      expect("backgrounds/builtin/x.jpg".startsWith(prefix)).toBe(false);
      expect(`backgrounds/${prefix}x`.startsWith(prefix)).toBe(false);
    }
    for (const rule of rules) {
      expect(rule.conditions.prefix).not.toBe("");
      expect(rule.conditions.prefix.startsWith("backgrounds")).toBe(false);
    }
  });

  it("writes ages in seconds: 35 days to delete, 2 days to abort an incomplete upload", () => {
    for (const rule of rules) {
      expect(rule.enabled).toBe(true);
      expect(rule.deleteObjectsTransition.condition).toEqual({ type: "Age", maxAge: 3_024_000 });
      expect(rule.abortMultipartUploadsTransition.condition).toEqual({
        type: "Age",
        maxAge: 172_800,
      });
    }
  });

  it("follows the days it is given (one constant to change)", () => {
    const changed = lifecycleRules(40, 3).rules[0]!;
    expect(changed.deleteObjectsTransition.condition.maxAge).toBe(40 * 86_400);
    expect(changed.abortMultipartUploadsTransition.condition.maxAge).toBe(3 * 86_400);
  });
});
