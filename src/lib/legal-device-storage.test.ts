import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEVICE_STORAGE } from "./legal-facts";
import { draftKey, settingsKey } from "./prompter-storage";

/** B2-T153: every key the site keeps in the browser is listed on the Privacy page. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

describe("device storage facts", () => {
  it("lists the prompter keys exactly as the code builds them", () => {
    const names = DEVICE_STORAGE.map((d) => d.name);
    expect(names).toContain(settingsKey("<your account id>"));
    expect(names).toContain(draftKey("<your account id>"));
  });

  it("lists the fan pause key of the home page", () => {
    const source = readFileSync("src/components/home/motion/fan-state.ts", "utf8");
    const key = /const KEY = "([^"]+)"/.exec(source)?.[1];
    expect(DEVICE_STORAGE.find((d) => d.name === key)?.store).toBe("sessionStorage");
  });

  it("fails when a file uses browser storage that no fact covers", () => {
    const known = new Set([
      "src/lib/prompter-storage.ts",
      "src/components/home/motion/fan-state.ts",
      // These two only name the stores in the facts and the page text.
      "src/lib/legal-facts-data.ts",
      "src/components/legal/privacy-data.tsx",
    ]);
    const users = sourceFiles("src").filter((p) =>
      /\b(localStorage|sessionStorage|indexedDB)\b/.test(readFileSync(p, "utf8")),
    );
    expect(users.filter((p) => !known.has(p))).toEqual([]);
    expect(DEVICE_STORAGE).toHaveLength(3);
  });
});
