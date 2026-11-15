import { existsSync, readFileSync } from "node:fs";

/**
 * B2-T140: what the built Worker was baked with. OpenNext copies the build's environment into
 * `.open-next/cloudflare/next-env.mjs`, and at run time the Worker reads only that. A test that
 * needs to know what the Worker will do (its own origin, who the insights viewer is) asks here,
 * not the `.env` file or the shell.
 */
const BAKED = ".open-next/cloudflare/next-env.mjs";

export function builtWorkerSetting(name: string): string | undefined {
  if (!existsSync(BAKED)) return undefined;
  const text = readFileSync(BAKED, "utf8");
  const line = text.split("\n").find((l) => l.startsWith("export const production"));
  const match = line ? new RegExp(`"${name}":"([^"]*)"`).exec(line) : null;
  return match?.[1];
}

/** The reason the Worker would refuse every request the tests send, or `null` when it will not. */
export function workerOriginProblem(baseURL: string): string | null {
  const baked = builtWorkerSetting("BETTER_AUTH_URL");
  if (baked === undefined)
    return `No built Worker found (${BAKED}). Run: bash tests/support/build-worker.sh`;
  if (new URL(baked).origin === new URL(baseURL).origin) return null;
  return (
    `The Worker was built with BETTER_AUTH_URL=${baked}, but the tests call ${baseURL}. ` +
    "The app refuses every write whose Origin is not its own, so many signed in specs fail with " +
    '"This request isn\'t allowed". Rebuild for tests: bash tests/support/build-worker.sh ' +
    "(it does not touch .env), then stop any old preview server on this port."
  );
}
