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

/** Key literals and storage call arguments in one file that no `DEVICE_STORAGE` fact covers. */
function undisclosedKeys(raw: string): string[] {
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const names = new Set(DEVICE_STORAGE.map((d) => d.name));
  const literals = [...source.matchAll(/(["`])((?:ts\.|take-studio:)[^"`]*)\1/g)].map((m) =>
    (m[2] ?? "").replace(/\$\{[^}]*\}/g, "<your account id>"),
  );
  // Every key passed to getItem, setItem or removeItem must be a known builder or constant.
  const calls = [
    ...source.matchAll(/\.(?:get|set|remove)Item\(\s*((?:["`][^"`]*["`])|(?:\w+(?:\([^)]*\))?))/g),
  ].map((m) => (m[1] ?? "").trim());
  const allowedCalls = new Set(["settingsKey(creatorId)", "draftKey(creatorId)", "KEY"]);
  return [...literals.filter((l) => !names.has(l)), ...calls.filter((c) => !allowedCalls.has(c))];
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

  it("covers every key used inside the known storage files", () => {
    for (const file of ["src/lib/prompter-storage.ts", "src/components/home/motion/fan-state.ts"])
      expect(undisclosedKeys(readFileSync(file, "utf8")), file).toEqual([]);
  });

  it("flags an undisclosed key inside a known storage file", () => {
    const extra =
      'const k = "ts.extra"; store.setItem("ts.other", "1"); store.getItem(`ts.x.${id}`);';
    expect(undisclosedKeys(extra)).toEqual([
      "ts.extra",
      "ts.other",
      "ts.x.<your account id>",
      '"ts.other"',
      "`ts.x.${id}`",
    ]);
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
