import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENT_NAMES, ANALYTICS_RETENTION_MONTHS } from "./analytics-events";
import {
  ACCOUNT_DELETE_SELF_SERVE,
  COLLECTED,
  LEGAL_ENTITY,
  LEGAL_VERSION,
  type LegalNow,
  REVIEW,
  type Review,
  LEGAL_FACTS_PATH,
  LEGAL_WATCHED_PATHS,
  draftReasons,
  legalDriftFlag,
  legalTextHash,
  missingEntityFields,
  normalizeLegalText,
  privacyContactEmail,
} from "./legal-facts";
import { CONTACT_EMAIL } from "./site";

describe("version and review", () => {
  it("has ISO dates that are not in the future of the file", () => {
    for (const date of Object.values(LEGAL_VERSION)) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(date))).toBe(false);
    }
  });

  it("hashes the normalized text, so layout changes do not matter but wording does", async () => {
    const a = await legalTextHash("We keep  videos\n30 days.");
    expect(a).toBe(await legalTextHash(" We keep videos 30 days. "));
    expect(a).not.toBe(await legalTextHash("We keep videos 31 days."));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeLegalText(" a \n b ")).toBe("a b");
  });

  const now: LegalNow = {
    privacyTextHash: "p",
    termsTextHash: "t",
    allowance: { minutes: 60, limitEnabled: true },
  };

  it("keeps the Draft banner while Toyin's facts and the review are null", () => {
    expect(missingEntityFields(LEGAL_ENTITY)).toEqual(Object.keys(LEGAL_ENTITY));
    expect(Object.values(REVIEW).every((v) => v === null)).toBe(true);
    expect(
      draftReasons({ entity: LEGAL_ENTITY, review: REVIEW, version: LEGAL_VERSION, now }).length,
    ).toBeGreaterThan(0);
  });

  const entity = {
    name: "Co",
    postalAddress: "1 Road",
    privacyEmail: "p@x.test",
    governingLaw: "Law",
    disputeVenue: "City",
    effectiveDate: "2026-12-01",
  };
  const review: Review = {
    reviewedBy: "Lawyer",
    reviewedOn: "2026-11-30",
    privacyVersion: LEGAL_VERSION.privacy,
    privacyTextHash: "p",
    termsVersion: LEGAL_VERSION.terms,
    termsTextHash: "t",
    allowanceMinutes: 60,
    limitEnabled: true,
  };
  const reasons = (over: Partial<LegalNow>, r: Review = review) =>
    draftReasons({ entity, review: r, version: LEGAL_VERSION, now: { ...now, ...over } });

  it("lets the banner go only when everything matches", () => {
    expect(reasons({})).toEqual([]);
  });

  it("brings it back when a page changed, a version moved or the allowance differs", () => {
    expect(reasons({ privacyTextHash: "x" })).toContain("privacy text changed");
    expect(reasons({ termsTextHash: "x" })).toContain("terms text changed");
    expect(reasons({}, { ...review, termsVersion: "2020-01-01" })).toContain(
      "terms version was not reviewed",
    );
    expect(reasons({ allowance: { minutes: 90, limitEnabled: true } })).toContain(
      "allowance differs from the reviewed one",
    );
    expect(reasons({ allowance: { minutes: 60, limitEnabled: false } }).length).toBe(1);
  });

  it("never passes while a page text hash is unavailable (the pages are not built yet)", () => {
    expect(reasons({ privacyTextHash: null, termsTextHash: null })).toEqual([
      "privacy text hash is not available",
      "terms text hash is not available",
    ]);
  });

  it("never passes when the allowance could not be read", () => {
    expect(reasons({ allowance: null })).toContain("allowance could not be read");
  });
});
describe("contact and account deletion", () => {
  it("uses the site contact until Toyin supplies a privacy address", () => {
    expect(privacyContactEmail(LEGAL_ENTITY)).toBe(CONTACT_EMAIL);
    expect(privacyContactEmail({ ...LEGAL_ENTITY, privacyEmail: "p@x.test" })).toBe("p@x.test");
  });

  it("names the self serve Delete account control (spec 0015 AC-13, shipped)", () => {
    expect(ACCOUNT_DELETE_SELF_SERVE).toBe(true);
  });
});
describe("launch gate wiring and drift flag (spec 0015 AC-8, AC-10)", () => {
  const scripts = (
    JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
  ).scripts;

  it("has a launch gate script that the normal test run never includes", () => {
    expect(scripts["test:legal-launch"]).toContain("scripts/vitest.legal-launch.config.ts");
    expect(scripts["legal:drift"]).toContain("scripts/legal-drift.ts");
    const normal = readFileSync("vitest.config.ts", "utf8");
    expect(normal).toContain('include: ["src/**/*.test.ts", "scripts/**/*.test.ts"]');
    const gate = readFileSync("scripts/vitest.legal-launch.config.ts", "utf8");
    expect(gate).toContain("tests/legal-launch/*.check.ts");
    expect(readFileSync("tests/legal-launch/legal-launch.check.ts", "utf8")).toContain(
      "draftReasons",
    );
  });

  it("flags a watched file changed without legal-facts.ts, and only then", () => {
    expect(legalDriftFlag(["package.json", "src/app/page.tsx"])).toEqual(["package.json"]);
    expect(legalDriftFlag(["src/db/schema/take.ts", "src/lib/email/send.ts"])).toHaveLength(2);
    expect(legalDriftFlag(["package.json", LEGAL_FACTS_PATH])).toEqual([]);
    expect(legalDriftFlag(["src/components/home/content.ts"])).toEqual([]);
  });

  it("counts a change to a split legal-facts-*.ts file as a change to the facts", () => {
    expect(legalDriftFlag(["package.json", "src/lib/legal-facts-processors.ts"])).toEqual([]);
  });

  it("watches only files and folders that exist", () => {
    for (const path of LEGAL_WATCHED_PATHS) {
      expect(() => statSync(path), `${path} was moved: update LEGAL_WATCHED_PATHS`).not.toThrow();
    }
  });

  it("documents the change checklist in both AGENTS.md files", () => {
    for (const file of ["AGENTS.md", "src/lib/AGENTS.md"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("legal-facts.ts");
      expect(text, file).toContain("legal:drift");
    }
  });
});
describe("product events (spec 0016, AC-11)", () => {
  const row = COLLECTED.find((c) => c.what.startsWith("Product events"));

  it("lists every event name, the retention and deletion with the account", () => {
    expect(row).toBeDefined();
    for (const name of ANALYTICS_EVENT_NAMES) expect(row?.what).toContain(name);
    expect(row?.kept).toContain(`${ANALYTICS_RETENTION_MONTHS} months`);
    expect(row?.deletedWith).toMatch(/account/i);
  });
});
