import { describe, expect, it } from "vitest";
import { probeKey } from "./trigger-runs";

describe("probeKey (S1C-T09)", () => {
  it("keeps the upload completion key and gives every re-dispatch its own", () => {
    const id = "6f0f6b0e-0000-4000-8000-000000000001";
    expect(probeKey(id)).toBe(`probe-${id}`);
    expect(probeKey(id, 0)).toBe(`probe-${id}`);
    expect(probeKey(id, 1)).toBe(`probe-${id}-1`);
    expect(new Set([probeKey(id), probeKey(id, 1), probeKey(id, 2), probeKey(id, 3)]).size).toBe(4);
  });
});
