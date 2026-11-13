import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Code boundaries from spec 0001 (Runtime rules). They keep heavy job code out of the
// Worker bundle and keep Worker only code out of jobs.
const webOnly = ["@/app", "@/app/*", "@/server", "@/server/*", "**/app/**", "**/server/**"];
const jobInternals = ["@/trigger", "@/trigger/*", "**/trigger/**"];
const heavySdks = ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*", "fluent-ffmpeg", "ffmpeg-static"];
const workerOnly = ["@opennextjs/cloudflare", "next", "next/*", "react", "react-dom"];

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
    files: ["src/trigger/**/*.{ts,tsx}"],
    rules: boundary(
      [...webOnly, ...workerOnly],
      "Jobs import only from src/db, src/lib and src/trigger (spec 0001).",
    ),
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
    rules: boundary(
      [...webOnly, ...jobInternals, "@opennextjs/cloudflare"],
      "Shared code (src/db, src/lib) must not depend on the web app or on jobs (spec 0001).",
    ),
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
