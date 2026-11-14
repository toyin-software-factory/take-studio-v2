import { describe, expect, it } from "vitest";
import {
  KEY_COPY,
  checkKeyName,
  createFailureMessage,
  createdKeySchema,
  keyDate,
  lastUsedText,
  revokeDone,
  withNewKey,
} from "./api-keys-screen";

describe("API keys screen helpers (spec 0018 AC-12)", () => {
  it("checks a name like the server: trimmed, 1 to 60", () => {
    expect(checkKeyName("  Zapier  ")).toEqual({ ok: true, name: "Zapier" });
    expect(checkKeyName("   ")).toEqual({ ok: false });
    expect(checkKeyName("a".repeat(60)).ok).toBe(true);
    expect(checkKeyName("a".repeat(61)).ok).toBe(false);
  });

  it("words the limit exactly as the spec does", () => {
    expect(KEY_COPY.limit).toBe("You already have 5 keys. Revoke one to make another.");
    expect(createFailureMessage(409, null)).toBe(KEY_COPY.limit);
    expect(createFailureMessage(422, null)).toBe(KEY_COPY.nameError);
  });

  it("uses a fixed line for a network failure or a server error, never raw error text", () => {
    expect(createFailureMessage(null, null)).toBe(KEY_COPY.createFailed);
    expect(createFailureMessage(500, { error: "x", message: "database down" })).toBe(
      KEY_COPY.createFailed,
    );
    expect(
      createFailureMessage(401, { error: "unauthorized", message: "Please sign in again." }),
    ).toBe("Please sign in again.");
  });

  it("counts 204 and 404 as a finished revoke", () => {
    expect(revokeDone(204)).toBe(true);
    expect(revokeDone(404)).toBe(true);
    expect(revokeDone(500)).toBe(false);
    expect(revokeDone(null)).toBe(false);
  });

  it("formats dates in UTC and writes Never used for null", () => {
    expect(keyDate("2026-11-14T23:30:00.000Z")).toBe("Nov 14, 2026");
    expect(lastUsedText(null)).toBe("Never used");
    expect(lastUsedText("2026-11-01T00:00:00.000Z")).toBe("Nov 1, 2026");
  });

  it("puts a new key first and never twice", () => {
    const a = { id: "a", name: "A", prefix: "tsk_aaaa", createdAt: "x", lastUsedAt: null };
    const b = { ...a, id: "b", name: "B" };
    expect(withNewKey([a], b).map((k) => k.id)).toEqual(["b", "a"]);
    expect(withNewKey([a, b], b).map((k) => k.id)).toEqual(["b", "a"]);
  });

  it("parses the 201 body and rejects one without a key", () => {
    const body = { id: "i", name: "n", prefix: "p", key: "tsk_x", createdAt: "t" };
    expect(createdKeySchema.safeParse(body).success).toBe(true);
    expect(createdKeySchema.safeParse({ ...body, key: "" }).success).toBe(false);
  });
});
