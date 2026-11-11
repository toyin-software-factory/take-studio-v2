import { z } from "zod";

/**
 * Guard for drizzle-kit: stops a local command from quietly running against a remote
 * database (for example production Neon, whose direct URL sits in builder sandboxes).
 *
 * It runs when drizzle-kit loads `drizzle.config.ts`, which every `pnpm db:*` script does.
 * Those scripts are the supported entry points. Credentials passed on the drizzle-kit command
 * line (`--url` and friends) skip the config file and therefore skip this guard.
 *
 * Commands that connect to a database refuse a non local host unless the run is in CI
 * (`CI=true`, set by GitHub Actions, used by the deploy workflow) or the caller opts in with
 * `MIGRATE_TARGET=prod`. Commands that never connect (generate, check, up, drop, export) pass
 * through. The host is printed before a connecting command runs; credentials never are.
 */

/** The guard's settings, parsed from the environment by `parseGuardEnv`. */
export type GuardEnv = { readonly ci: boolean; readonly optedIn: boolean };

const guardEnvSchema = z.object({
  CI: z.string().optional(),
  MIGRATE_TARGET: z
    .enum(["prod"], { message: 'MIGRATE_TARGET must be "prod" when set' })
    .optional(),
});

/** Validates `CI` and `MIGRATE_TARGET` (zod at the env boundary); errors name the setting. */
export function parseGuardEnv(
  source: Readonly<Record<string, string | undefined>>,
):
  { readonly ok: true; readonly env: GuardEnv } | { readonly ok: false; readonly message: string } {
  const parsed = guardEnvSchema.safeParse({
    CI: source.CI || undefined,
    MIGRATE_TARGET: source.MIGRATE_TARGET || undefined,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    return { ok: false, message: `drizzle-kit guard: invalid setting. ${issues}.` };
  }
  return {
    ok: true,
    env: { ci: isTruthy(parsed.data.CI), optedIn: parsed.data.MIGRATE_TARGET === "prod" },
  };
}

export type DbGuardResult =
  | { readonly ok: true; readonly message: string | null }
  | { readonly ok: false; readonly message: string };

/** drizzle-kit commands that only read and write files, never a database. */
const OFFLINE_COMMANDS: ReadonlySet<string> = new Set([
  "generate",
  "check",
  "up",
  "drop",
  "export",
]);

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The drizzle-kit subcommand from argv (`drizzle-kit migrate ...` → `migrate`), if any. */
export function drizzleCommand(argv: readonly string[]): string | null {
  const bin = argv.findIndex((arg) => /drizzle-kit/.test(arg));
  const rest = bin === -1 ? argv.slice(2) : argv.slice(bin + 1);
  return rest.find((arg) => !arg.startsWith("-")) ?? null;
}

/** Hostname of a Postgres URL, or null when the URL can't be parsed. */
export function dbHost(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** True for loopback hosts: localhost, 127.x and ::1. */
function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || host.startsWith("127.");
}

/** True for the values CI systems use to switch a flag on (`true`, `1`). */
function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** Decides whether a drizzle-kit command may run against `url`. Pure; no side effects. */
export function checkDbTarget(url: string, command: string | null, env: GuardEnv): DbGuardResult {
  if (command !== null && OFFLINE_COMMANDS.has(command)) return { ok: true, message: null };

  const label = `drizzle-kit ${command ?? "(unknown command)"}`;
  const host = dbHost(url);
  if (host === null) {
    return { ok: false, message: `${label}: refusing to run, the database URL can't be parsed.` };
  }
  if (isLocalHost(host)) return { ok: true, message: `${label} → ${host} (local)` };

  if (env.ci || env.optedIn) {
    const why = env.ci ? "CI" : "MIGRATE_TARGET=prod";
    return { ok: true, message: `${label} → ${host} (remote, allowed by ${why})` };
  }

  return {
    ok: false,
    message: [
      `${label}: refusing to run against remote database host ${host}.`,
      "Local drizzle-kit commands only target localhost. DATABASE_URL_DIRECT (or .env) points elsewhere.",
      "For local Postgres:  DATABASE_URL_DIRECT=postgres://postgres:postgres@localhost:5432/take_studio pnpm db:migrate",
      "To really target this host (production deploys run only from CI): MIGRATE_TARGET=prod pnpm db:migrate",
    ].join("\n"),
  };
}

/** Runs the guard for this process: prints the target, or prints why and exits non zero. */
export function guardDbTarget(url: string): void {
  const settings = parseGuardEnv(process.env);
  if (!settings.ok) {
    console.error(settings.message);
    process.exit(1);
  }
  const result = checkDbTarget(url, drizzleCommand(process.argv), settings.env);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  if (result.message) console.error(result.message);
}
