import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  BLOCKED_PROP_KEYS,
  aiEditOutcome,
  insightsWindowSchema,
  parseEventProps,
} from "./analytics-events";

/** True when a schema field can hold free text (a string that is not an enum or literal). */
function allowsFreeText(field: z.ZodType): boolean {
  const type = (field as { _zod: { def: { type: string } } })._zod.def.type;
  if (type === "object") {
    // A nested object (the cut counts, spec 0017): every key and every leaf is checked too.
    const shape = (field as unknown as { shape: Record<string, z.ZodType> }).shape;
    return Object.entries(shape).some(
      ([key, child]) =>
        (BLOCKED_PROP_KEYS as readonly string[]).includes(key) || allowsFreeText(child),
    );
  }
  return !["enum", "literal", "number", "boolean"].includes(type);
}

describe("analytics events (spec 0016, AC-2, AC-3)", () => {
  it("is the closed list of eleven names", () => {
    expect([...ANALYTICS_EVENT_NAMES]).toEqual([
      "signup",
      "take_uploaded",
      "take_ready",
      "ai_edit_used",
      "change_requested",
      "take_downloaded",
      "transcript_downloaded",
      "take_failed",
      "cuts_reviewed",
      "cut_missed",
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

describe("parseEventProps and aiEditOutcome (spec 0016, AC-4)", () => {
  it("returns the parsed props or null", () => {
    expect(parseEventProps("take_ready", { aiEdit: "done", cuts: 2 })).toEqual({
      aiEdit: "done",
      cuts: 2,
    });
    expect(parseEventProps("take_ready", { aiEdit: "maybe", cuts: 2 })).toBeNull();
    expect(parseEventProps("signup", undefined)).toEqual({});
    expect(parseEventProps("signup", { email: "a@b.c" })).toBeNull();
  });

  it("reads the AI edit outcome the way the take page does", () => {
    expect(aiEditOutcome({ status: "succeeded", failureCode: null })).toBe("done");
    expect(aiEditOutcome({ status: "skipped", failureCode: "ai_unavailable" })).toBe("unavailable");
    expect(aiEditOutcome({ status: "skipped", failureCode: "no_speech" })).toBe("none");
    expect(aiEditOutcome({ status: "failed", failureCode: "ai_unavailable" })).toBe("none");
    expect(aiEditOutcome(undefined)).toBe("none");
  });
});
