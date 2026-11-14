import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LegalEntity } from "@/lib/legal-facts";
import { DraftBanner } from "./draft-banner";
import { Operator } from "./operator";
import { TermsCopy } from "./terms-copy";

// An explicit unset entity, so these tests hold whatever the production facts file holds.
const UNSET: LegalEntity = {
  name: null,
  postalAddress: null,
  privacyEmail: null,
  governingLaw: null,
  disputeVenue: null,
  effectiveDate: null,
};

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("unset entity values (spec 0015 AC-8)", () => {
  it("shows no operator lines while the name and address are null", () => {
    expect(html(createElement(Operator, { entity: UNSET }))).toBe("");
  });
  it("leaves the governing law and effective date out of the Terms while null", () => {
    const out = html(createElement(TermsCopy, { entity: UNSET, allowance: { kind: "off" } }));
    expect(out).not.toContain("governed by");
    expect(out).not.toContain("take effect");
    expect(out).not.toContain("null");
  });
  it("shows the values once supplied", () => {
    const entity = { ...UNSET, name: "Acme Ltd", governingLaw: "England and Wales" };
    expect(html(createElement(Operator, { entity }))).toContain("Acme Ltd");
    const out = html(createElement(TermsCopy, { entity, allowance: { kind: "off" } }));
    expect(out).toContain("law of England and Wales");
  });
});

describe("the Draft banner", () => {
  it("shows while there is a reason and goes when there is none", () => {
    expect(html(createElement(DraftBanner, { reasons: ["x"] }))).toContain("Draft, pending review");
    expect(html(createElement(DraftBanner, { reasons: [] }))).toBe("");
  });
});
