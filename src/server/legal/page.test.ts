import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LEGAL_ENTITY, PUBLIC_VIEWER } from "@/lib/legal-facts";
import { legalAllowance } from "./allowance";
import { allowanceState } from "./page";

vi.mock("../request", () => ({ getDb: vi.fn() }));
vi.mock("@/db/data/usage", () => ({ readUsageSettings: vi.fn() }));

describe("allowanceState (spec 0015 value sourcing)", () => {
  it("says the minutes when the limit is on", () => {
    expect(allowanceState({ minutes: 60, limitEnabled: true })).toEqual({
      kind: "on",
      minutes: "60",
    });
  });
  it("states no number when the limit is off", () => {
    expect(allowanceState({ minutes: 60, limitEnabled: false })).toEqual({ kind: "off" });
  });
  it("says unavailable, never a default, when the read failed", () => {
    expect(allowanceState(null)).toEqual({ kind: "unavailable" });
  });
});

describe("legalAllowance", () => {
  it("reads the settings for the fixed public viewer, in minutes", async () => {
    const { readUsageSettings } = await import("@/db/data/usage");
    vi.mocked(readUsageSettings).mockResolvedValueOnce({
      freeMonthlySeconds: 5400,
      limitEnabled: true,
    });
    expect(PUBLIC_VIEWER.accountHash).toBe("public-viewer");
    expect(await legalAllowance(async () => ({}) as never)).toEqual({
      minutes: 90,
      limitEnabled: true,
    });
  });
  it("returns null when the read throws", async () => {
    const { readUsageSettings } = await import("@/db/data/usage");
    vi.mocked(readUsageSettings).mockRejectedValueOnce(new Error("down"));
    expect(await legalAllowance(async () => ({}) as never)).toBeNull();
  });
});

describe("the legal pages (spec 0015 AC-1, value sourcing)", () => {
  for (const page of ["privacy", "terms"]) {
    const source = readFileSync(`src/app/${page}/page.tsx`, "utf8");
    it(`${page}: public and dynamic, never reads the session or redirects`, () => {
      expect(source).toContain('export const dynamic = "force-dynamic"');
      expect(source).not.toMatch(/getSession|redirect|headers\(/);
    });
    it(`${page}: has a title, a description and a canonical link`, () => {
      expect(source).toMatch(/title: ".* · Take Studio"/);
      expect(source).toContain("description:");
      expect(source).toContain(`canonical: "/${page}"`);
    });
  }
  it("starts with every entity value unset, so no value is invented", () => {
    expect(Object.values(LEGAL_ENTITY).every((v) => v === null)).toBe(true);
  });
});
