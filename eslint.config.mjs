import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Code boundaries from spec 0001 (Runtime rules). They keep heavy job code out of the
// Worker bundle and keep Worker only code out of jobs.
const webOnly = ["@/app", "@/app/*", "@/server", "@/server/*", "**/app/**", "**/server/**"];
const jobInternals = ["@/trigger", "@/trigger/*", "**/trigger/**"];
const heavySdks = ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*", "fluent-ffmpeg", "ffmpeg-static"];
const testsDir = ["@/tests", "@/tests/*", "**/tests/**"];
const workerOnly = ["@opennextjs/cloudflare", "next", "next/*", "react", "react-dom"];

// Selectors for rules that used to be prose in AGENTS.md (see the block before globalIgnores).
const sonnerSource = String.raw`/^sonner(\/|$)|sonner-impl$/`;
const fullscreenMethod = "/^(requestFullscreen|webkitRequestFullscreen|webkitEnterFullscreen)$/";

const boundary = (patterns, message, allowTypeImports = false) => ({
  "no-restricted-imports": [
    "error",
    { patterns: [{ group: patterns, message, allowTypeImports }] },
  ],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // Non test code under src/ must not depend on tests/ (B2-T125): the Worker and job bundles
    // would carry test files. Test files and src/test are exempt here; the src/trigger, src/app, src/server, src/db and
    // src/lib blocks below carry the same tests/ pattern themselves (a later block replaces this rule).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: testsDir,
              message:
                "Code in src/ must not import from tests/: keep shared data in src (B2-T125).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/trigger/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...webOnly, ...workerOnly],
              message: "Jobs import only from src/db, src/lib and src/trigger (spec 0001).",
            },
            {
              group: testsDir,
              message: "Jobs must not import from tests/: move shared data into src/lib (B2-T125).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: jobInternals,
              allowTypeImports: true,
              message:
                "The web app may only import task types from src/trigger (for tasks.trigger), never task code (spec 0001).",
            },
            {
              group: testsDir,
              message:
                "Code in src/ must not import from tests/: keep shared data in src (B2-T125).",
            },
            {
              group: heavySdks,
              message:
                "Heavy SDKs belong in src/trigger jobs, never in the Worker bundle (spec 0001).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/db/**/*.ts", "src/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...webOnly, ...jobInternals, "@opennextjs/cloudflare"],
              message:
                "Shared code (src/db, src/lib) must not depend on the web app or on jobs (spec 0001).",
            },
            {
              group: testsDir,
              message:
                "Code in src/ must not import from tests/: keep shared data in src (B2-T125).",
            },
          ],
        },
      ],
    },
  },
  {
    // Rules that used to live only in AGENTS.md, now checked (ROLE.md "Corrections become checks").
    // The helper files themselves and unit tests are exempt.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/*.test.{ts,tsx}",
      "src/test/**",
      "src/components/ui/sonner.tsx",
      "src/components/ui/sonner-impl.tsx",
      "src/lib/fullscreen.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "ImportDeclaration",
          "ImportExpression",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
        ].map((node) => ({
          selector: `${node}[source.value=${sonnerSource}]`,
          message:
            "Toasts go through `notify` from @/components/ui/sonner. Importing sonner or sonner-impl directly puts about 32 KB back in the first load (B2-T109).",
        })),
        ...[
          `MemberExpression[property.name=${fullscreenMethod}]`,
          `MemberExpression[computed=true][property.value=${fullscreenMethod}]`,
        ].map((selector) => ({
          selector,
          message:
            "Full screen goes through `enterFullscreen` from @/lib/fullscreen, which falls back to the WebKit methods iPhone Safari needs.",
        })),
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    ".trigger/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
    ".claude/**",
    "tools/design-check/**",
    ".pnpm-store/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
