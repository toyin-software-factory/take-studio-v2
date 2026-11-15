import { describe, expect, it } from "vitest";
import { ORACLE } from "./client-schema-oracle";
import {} from "./background-preview-api";
import {} from "./prompter-storage";
import { siteOrigin } from "./site";
import { takeDetailSchema } from "./take-api";
import {} from "@/components/takes/email-switch";
import {} from "@/components/takes/rename-form";
import {} from "@/components/takes/use-usage";
import {} from "@/components/takes/use-waveform";
import { cases } from "./client-schemas-cases";
import { detailOld } from "./client-schemas-fixtures";
import { sameAnswer, variations } from "./client-schemas-helpers";

/**
 * B2-T108: the browser's response schemas moved from full zod to `zod/mini`. Each pair below is
 * the new schema and the old one (`client-schema-oracle.ts`). Every fixture, and every
 * variation made from it (a field dropped, nulled, given the wrong type or an odd number, an
 * extra key added), must pass or fail the same way and parse to the same data.
 */

describe("client schemas: zod/mini against the old full zod shapes (B2-T108)", () => {
  for (const c of cases) {
    it(`${c.name}: fixtures and variations give the same answers`, () => {
      const differences: string[] = [];
      let accepted = 0;
      for (const fixture of c.fixtures) {
        for (const input of [fixture, ...variations(fixture)]) {
          const why = sameAnswer(c.next, c.old, input);
          if (why) differences.push(`${why}: ${JSON.stringify(input)}`);
          if (c.old.safeParse(input).success) accepted += 1;
        }
      }
      expect(differences.slice(0, 5)).toEqual([]);
      expect(accepted).toBeGreaterThan(0);
    });
  }

  it("takeDetail fills the same defaults as before", () => {
    const parsed = takeDetailSchema.safeParse(detailOld);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.originalAvailable).toBe(true);
    expect(parsed.data.aiEdit).toBeNull();
    expect(parsed.data.noGreenScreen).toBe(false);
    expect(parsed.data.cuts[0]?.proposedBy).toBe("rules");
    expect(parsed.data.latestRender?.removedRanges).toEqual([]);
  });

  it("siteOrigin accepts and refuses what the full zod url check did", () => {
    const inputs = [
      undefined,
      "",
      "x",
      "https://take.studio",
      "http://localhost:3000/a?b=1",
      "ftp://h/p",
      "//h",
      "https://",
      "mailto:a@b.c",
      "javascript:alert(1)",
      "HTTPS://A.TEST",
      " https://a.test",
      "https://a b.test",
    ];
    for (const input of inputs) {
      const old = ORACLE.siteUrl.safeParse(input);
      expect(siteOrigin(input), String(input)).toBe(old.success ? new URL(old.data).origin : null);
    }
  });
});
