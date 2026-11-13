import { describe, expect, it } from "vitest";
import { MEDIA_LIMITS, VIDEO_RETENTION_DAYS } from "@/lib/take-rules";
import { softwareApplicationLd } from "./json-ld";
import * as content from "./content";

/** Every string the homepage says, flattened from the copy module. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
const copy = strings([
  content.HERO,
  content.REEL,
  content.PROOF,
  content.STUDIO,
  content.CAPABILITIES,
  content.LIMITS,
  content.FAQ,
  content.CLOSING,
  content.FOOTER,
  content.homeLimits(),
]).join("\n");

describe("homepage copy is true today (spec 0010, AC-2)", () => {
  it("does not promise the review timeline, undoing cuts, agents choosing cuts or a monthly limit", () => {
    for (const claim of [
      /review timeline/i,
      /\bundo\b/i,
      /keep the ones you want back/i,
      /tap any cut/i,
      /agents? (mark|choose|pick|decide)/i,
      /monthly/i,
      /invite/i,
    ]) {
      expect(copy, String(claim)).not.toMatch(claim);
    }
  });

  it("says coming soon only about the public API and the MCP server", () => {
    const soon = content.STUDIO.agents.text + content.CAPABILITIES.tiles[3].text;
    expect(soon).toMatch(/API and (an )?MCP/);
    const lines = copy.split("\n").filter((l) => /coming soon|\(soon\)|^Soon\./i.test(l));
    for (const line of lines) expect(line).toMatch(/API|MCP|Coming soon$|Soon\./);
  });

  it("has the closing sign in form (an email link, not an invite form) and the contact address", () => {
    expect(content.CLOSING.cta).toBe("Email me a sign in link");
    expect(content.CLOSING.email).toBe("hello@takestudio.app");
    // The draft's "Get my invite" form took a name and what you film; ours only asks for an email.
    expect(copy).not.toMatch(/your name|get my invite|what do you film/i);
    expect(content.CLOSING.sent("a@b.co")).toContain("a@b.co");
  });

  it("leaves the Legal column at the email until Privacy and Terms ship (feature 16)", () => {
    const legal = content.FOOTER.columns.find((c) => c.label === "Legal");
    expect(legal?.links.map((l) => l.label)).toEqual(["hello@takestudio.app"]);
  });
});

describe("the limits come from the rules (spec 0010, value sourcing)", () => {
  it("are 10 min, 2 GB, 1080p and 30 days, read from MEDIA_LIMITS and the retention days", () => {
    expect(content.homeLimits().map((l) => [l.value, l.unit])).toEqual([
      [MEDIA_LIMITS.maxDurationMs / 60_000, "min"],
      [MEDIA_LIMITS.maxBytes / 1024 ** 3, "GB"],
      [MEDIA_LIMITS.maxShortSide, "p"],
      [VIDEO_RETENTION_DAYS, "days"],
    ]);
    expect(content.homeLimits().map((l) => `${l.value}${l.unit}`)).toEqual([
      "10min",
      "2GB",
      "1080p",
      "30days",
    ]);
  });
  it("never type 1080p by hand: the chips and the FAQ read MEDIA_LIMITS", () => {
    const text = `${MEDIA_LIMITS.maxShortSide}p`;
    expect(content.PROOF.formats).toContain(text);
    expect(content.FAQ.items[1]!.a).toContain(`up to ${text}`);
  });
  it("say when each upload check happens (type and size before, length and resolution after)", () => {
    const a = content.FAQ.items[1]!.a;
    expect(a).toContain("before upload");
    expect(a).toContain("after upload");
    expect(a).not.toMatch(/before anything uploads/);
  });
  it("show up in the FAQ and the format chips", () => {
    expect(content.FAQ.items[1]!.a).toContain("10 minutes");
    expect(content.FAQ.items[1]!.a).toContain("2 GB");
    expect(content.PROOF.formats).toContain("10 min");
    expect(content.PROOF.formats).toContain("2 GB");
  });
});

describe("SoftwareApplication JSON-LD (AC-3)", () => {
  it("names the app, a web category and the url when the origin is known", () => {
    const ld = softwareApplicationLd("https://take.example.com");
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Take Studio",
      operatingSystem: "Web",
      url: "https://take.example.com/",
    });
    expect(softwareApplicationLd(null)).not.toHaveProperty("url");
  });
});
