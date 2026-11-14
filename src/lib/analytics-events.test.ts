import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  BLOCKED_PROP_KEYS,
  insightsWindowSchema,
} from "./analytics-events";

/** True when a schema field can hold free text (a string that is not an enum or literal). */
function allowsFreeText(field: z.ZodType): boolean {
  const type = (field as { _zod: { def: { type: string } } })._zod.def.type;
  return !["enum", "literal", "number", "boolean"].includes(type);
}

describe("analytics events (spec 0016, AC-2, AC-3)", () => {
  it("is the closed list of nine names", () => {
    expect([...ANALYTICS_EVENT_NAMES]).toEqual([
      "signup",
      "take_uploaded",
      "take_ready",
      "ai_edit_used",
      "change_requested",
      "take_downloaded",
      "transcript_downloaded",
      "take_failed",
      "limit_hit",
    ]);
  });

  it("allows only enums, numbers and booleans, and no blocklisted key", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const shape = ANALYTICS_EVENTS[name].props.shape as Record<string, z.ZodType>;
      for (const [key, field] of Object.entries(shape)) {
        expect(BLOCKED_PROP_KEYS as readonly string[], `${name}.${key}`).not.toContain(key);
        expect(allowsFreeText(field), `${name}.${key} allows free text`).toBe(false);
      }
    }
  });

  it("rejects an extra key and free text where a code is expected", () => {
    expect(ANALYTICS_EVENTS.signup.props.safeParse({ email: "a@b.c" }).success).toBe(false);
    expect(ANALYTICS_EVENTS.take_failed.props.safeParse({ code: "my secret title" }).success).toBe(
      false,
    );
    expect(ANALYTICS_EVENTS.take_ready.props.safeParse({ aiEdit: "done", cuts: 3 }).success).toBe(
      true,
    );
  });

  it("falls back to 30 days for a bad window", () => {
    expect(insightsWindowSchema.parse("7d")).toBe("7d");
    expect(insightsWindowSchema.parse("bogus")).toBe("30d");
    expect(insightsWindowSchema.parse(undefined)).toBe("30d");
  });
});
