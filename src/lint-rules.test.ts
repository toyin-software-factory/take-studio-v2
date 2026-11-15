import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Rules that used to be prose in AGENTS.md, now enforced by `no-restricted-syntax` in
 * eslint.config.mjs (ROLE.md "Corrections become checks"). Lints source text as if it lived at a
 * given path, using the project's real ESLint config.
 */
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

/** The `no-restricted-syntax` messages for `code` placed at `filePath`. */
async function ruleErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-syntax")
    .map((message) => message.message);
}

describe("toasts go through notify (B2-T109)", { timeout: 60_000 }, () => {
  it("stops pages and components from importing sonner or sonner-impl", async () => {
    const code = [
      'import { toast } from "sonner";',
      'import { ToasterRegion } from "@/components/ui/sonner-impl";',
      'export { toast as t } from "sonner";',
      'export const load = () => import("./sonner-impl");',
      "export const x = [toast, ToasterRegion];",
      "",
    ].join("\n");
    for (const file of ["src/app/library/page.tsx", "src/components/takes/example.tsx"]) {
      const errors = await ruleErrors(file, code);
      expect(errors, file).toHaveLength(4);
      expect(errors[0], file).toContain("Toasts go through `notify`");
    }
  });

  it("lets code import notify from the sonner wrapper", async () => {
    expect(
      await ruleErrors(
        "src/components/takes/example.tsx",
        'import { notify } from "@/components/ui/sonner";\nexport const x = notify;\n',
      ),
    ).toEqual([]);
  });

  it("lets the wrapper itself load sonner-impl", async () => {
    expect(
      await ruleErrors(
        "src/components/ui/sonner.tsx",
        'export const load = () => import("./sonner-impl");\n',
      ),
    ).toEqual([]);
  });
});

describe("full screen goes through enterFullscreen", { timeout: 60_000 }, () => {
  it("stops code from calling the browser's full screen methods directly", async () => {
    const code = [
      "export function go(video: HTMLVideoElement & { webkitEnterFullscreen?: () => void }) {",
      "  void video.requestFullscreen();",
      "  video.webkitEnterFullscreen?.();",
      "}",
      "",
    ].join("\n");
    const errors = await ruleErrors("src/components/takes/example.tsx", code);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Full screen goes through `enterFullscreen`");
  });

  it("lets code call enterFullscreen", async () => {
    expect(
      await ruleErrors(
        "src/components/takes/example.tsx",
        'import { enterFullscreen } from "@/lib/fullscreen";\nexport const go = (v: HTMLVideoElement) => enterFullscreen(v);\n',
      ),
    ).toEqual([]);
  });
});
