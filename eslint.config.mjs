import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import { fetchMessage, proseSelectors, zodMessage, zodSource } from "./eslint.selectors.mjs";

// Code boundaries from spec 0001 (Runtime rules). They keep heavy job code out of the
// Worker bundle and keep Worker only code out of jobs.
const webOnly = ["@/app", "@/app/*", "@/server", "@/server/*", "**/app/**", "**/server/**"];
const jobInternals = ["@/trigger", "@/trigger/*", "**/trigger/**"];
const heavySdks = ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*", "fluent-ffmpeg", "ffmpeg-static"];
const testsDir = ["@/tests", "@/tests/*", "**/tests/**"];
const workerOnly = ["@opennextjs/cloudflare", "next", "next/*", "react", "react-dom"];

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
      "no-restricted-syntax": ["error", ...proseSelectors],
    },
  },
  {
    // Components also refuse a dynamic `import("zod")` (a block of its own replaces the one above, so it repeats its selectors).
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: [
      "src/**/*.test.{ts,tsx}",
      "src/components/ui/sonner.tsx",
      "src/components/ui/sonner-impl.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...proseSelectors,
        {
          selector: `ImportExpression[source.value=${zodSource}]`,
          message: zodMessage,
        },
      ],
    },
  },
  {
    // B2-T133: more rules that used to be prose in AGENTS.md, each under a rule name of its own
    // (a later block replaces an earlier one's settings for the same rule).
    files: ["src/**/*.{ts,tsx}"],
    rules: { "import/no-default-export": "error" },
  },
  {
    // Default exports the framework or the Worker runtime requires.
    files: [
      "src/app/**/{page,layout,template,default,loading,error,global-error,not-found}.tsx",
      "src/app/**/{route,robots,sitemap,manifest}.ts",
      "src/worker.ts",
      "src/**/*.d.ts",
    ],
    rules: { "import/no-default-export": "off" },
  },
  {
    files: ["src/app/error.tsx", "src/app/global-error.tsx"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...["error", "err"].map((object) => ({
          object,
          property: "message",
          message:
            "Error pages never show the raw error. Show a fixed friendly sentence and report the error by ID (reportBrowserError).",
        })),
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["zod", "zod/v3", "zod/v4"].map((name) => ({
            name,
            message: zodMessage,
          })),
          patterns: [
            {
              group: testsDir,
              message:
                "Code in src/ must not import from tests/: keep shared data in src (B2-T125).",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", { name: "fetch", message: fetchMessage }],
      // `window.fetch(...)` and `globalThis.fetch(...)` are not globals to ESLint, so they need their own check.
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].map((object) => ({
          object,
          property: "fetch",
          message: fetchMessage,
        })),
      ],
    },
  },
  {
    // `callApi` itself, and the part upload, which PUTs a file to a presigned R2 link (not our JSON API).
    files: ["src/components/takes/browser-io.ts", "src/components/takes/use-background-upload.ts"],
    rules: { "no-restricted-globals": "off", "no-restricted-properties": "off" },
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
