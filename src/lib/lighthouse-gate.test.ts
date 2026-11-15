import { describe, expect, it } from "vitest";
import { type GatePage, gateViolations } from "../../scripts/lighthouse-gate";

const clean = { accessibility: 1, "best-practices": 1, seo: 1 } as const;
const landing: GatePage = { name: "Landing", indexable: true, scores: clean, failedSeoAudits: [] };
const library: GatePage = {
  name: "Library",
  indexable: false,
  scores: { ...clean, seo: 0.63 },
  failedSeoAudits: ["is-crawlable"],
};

describe("the Lighthouse score gate (B2-T114)", () => {
  it("passes the recorded numbers: 100s on the landing page, is-crawlable only on noindex pages", () => {
    expect(gateViolations([landing, library])).toEqual([]);
  });

  it.each(["accessibility", "best-practices", "seo"] as const)(
    "fails the landing page when %s drops below 100",
    (category) => {
      const page = { ...landing, scores: { ...clean, [category]: 0.96 } };
      const [only, ...rest] = gateViolations([page]);
      expect(rest).toEqual([]);
      expect(only).toContain(`Landing: ${category} is 96`);
    },
  );

  it("fails a noindex page when accessibility or best practices drop", () => {
    const page = { ...library, scores: { ...library.scores, "best-practices": 0.96 } };
    expect(gateViolations([page])).toHaveLength(1);
    expect(
      gateViolations([{ ...library, scores: { ...library.scores, accessibility: 0.9 } }]),
    ).toHaveLength(1);
  });

  it("does not hold a noindex page to a 100 in SEO, only to is-crawlable being its one failure", () => {
    expect(gateViolations([library])).toEqual([]);
    const extra = { ...library, failedSeoAudits: ["is-crawlable", "meta-description"] };
    expect(gateViolations([extra])).toEqual([expect.stringContaining("meta-description")]);
  });

  it("flags a noindex page that stopped failing is-crawlable", () => {
    const page = { ...library, failedSeoAudits: [] };
    expect(gateViolations([page])).toEqual([expect.stringContaining("lost its noindex")]);
  });

  it("rejects a null SEO score on a noindex page too", () => {
    const page = { ...library, scores: { ...clean, seo: null } };
    expect(gateViolations([page])).toEqual([expect.stringContaining("seo has no score")]);
  });

  it("treats a missing score as a failure, not a pass", () => {
    const page = { ...landing, scores: { ...clean, "best-practices": null } };
    expect(gateViolations([page])).toEqual([expect.stringContaining("has no score")]);
  });
});
