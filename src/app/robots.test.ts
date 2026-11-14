import { describe, expect, it } from "vitest";
import { PRIVATE_PATHS } from "@/lib/site";
import robots from "./robots";
import sitemap from "./sitemap";

describe("robots and sitemap (spec 0010, AC-3)", () => {
  const withOrigin = async <T>(value: string | undefined, run: () => T): Promise<T> => {
    const before = process.env.BETTER_AUTH_URL;
    if (value === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = value;
    try {
      return run();
    } finally {
      if (before === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = before;
    }
  };

  it("lists / and keeps the app, the gallery and the API out", async () => {
    const out = await withOrigin("https://take.example.com", () => ({
      robots: robots(),
      sitemap: sitemap(),
    }));
    expect(out.sitemap.map((entry) => entry.url)).toEqual([
      "https://take.example.com/",
      "https://take.example.com/privacy",
      "https://take.example.com/terms",
    ]);
    expect(out.robots.sitemap).toBe("https://take.example.com/sitemap.xml");
    const rules = out.robots.rules as { allow: string; disallow: string[] };
    expect(rules.allow).toBe("/");
    for (const path of ["/takes", "/library", "/design", "/api/"])
      expect(rules.disallow).toContain(path);
    expect(rules.disallow).toEqual([...PRIVATE_PATHS]);
  });

  it("leaves the sitemap empty and robots without a sitemap line when the origin is unknown", async () => {
    const out = await withOrigin(undefined, () => ({ robots: robots(), sitemap: sitemap() }));
    expect(out.sitemap).toEqual([]);
    expect(out.robots.sitemap).toBeUndefined();
  });
});
