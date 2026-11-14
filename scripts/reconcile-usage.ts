/**
 * The one time usage reconcile (spec 0014, AC-11): `pnpm usage:reconcile`. Applies the
 * difference between `processing_job` charges and `usage_month` (jobs charged but not yet
 * counted are added, jobs refunded after they were counted are subtracted), then prints the
 * counts. Safe to run again: a second run finds nothing. Never prints an account hash, an email
 * or a take ID. It uses the same guard as `pnpm db:seed`: a database that is not on this machine
 * is refused unless the run is in CI or `MIGRATE_TARGET=prod`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { reconcileUsage } from "../src/db/data/usage-reconcile";
import * as schema from "../src/db/schema";

const env = z
  .object({
    DATABASE_URL_DIRECT: z.url(),
    CI: z.string().optional(),
    MIGRATE_TARGET: z.enum(["prod"]).optional(),
  })
  .parse(process.env);

const host = new URL(env.DATABASE_URL_DIRECT).hostname;
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
// Only the exact values authorise a remote database: CI "false" or "1" does not.
if (!local && env.CI !== "true" && env.MIGRATE_TARGET !== "prod") {
  throw new Error(
    `Refusing to reconcile the non local database host ${host}. Use a local database, or set MIGRATE_TARGET=prod on purpose.`,
  );
}
console.log(`reconcile-usage → ${host}${local ? " (local)" : ""}`);

const client = postgres(env.DATABASE_URL_DIRECT, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });

try {
  const summary = await reconcileUsage(db);
  console.log(
    `reconcile-usage: ${summary.jobs} jobs, ${summary.added} seconds added, ${summary.subtracted} seconds subtracted`,
  );
} finally {
  await client.end();
}
