/**
 * Guard for drizzle-kit: stops a local command from quietly running against a remote
 * database (for example production Neon, whose direct URL sits in builder sandboxes).
 *
 * drizzle-kit commands that connect to a database refuse a non local host unless the run is
 * in CI (`CI=true`, set by GitHub Actions, used by the deploy workflow) or the caller opts in
 * with `MIGRATE_TARGET=prod`. Commands that never connect (generate, check, up, drop, export)
 * pass through. The host is printed before a connecting command runs; credentials never are.
 */

type Env = Readonly<Record<string, string | undefined>>;

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

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || host.startsWith("127.");
}

function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** Decides whether a drizzle-kit command may run against `url`. Pure; no side effects. */
export function checkDbTarget(url: string, command: string | null, env: Env): DbGuardResult {
  if (command !== null && OFFLINE_COMMANDS.has(command)) return { ok: true, message: null };

  const label = `drizzle-kit ${command ?? "(unknown command)"}`;
  const host = dbHost(url);
  if (host === null) {
    return { ok: false, message: `${label}: refusing to run, the database URL can't be parsed.` };
  }
  if (isLocalHost(host)) return { ok: true, message: `${label} → ${host} (local)` };

  const ci = isTruthy(env.CI);
  const optedIn = env.MIGRATE_TARGET === "prod";
  if (ci || optedIn) {
    const why = ci ? "CI" : "MIGRATE_TARGET=prod";
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
  const result = checkDbTarget(url, drizzleCommand(process.argv), process.env);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  if (result.message) console.error(result.message);
}
