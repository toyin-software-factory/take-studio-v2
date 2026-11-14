/**
 * The one time analytics backfill (spec 0016, AC-12): `pnpm analytics:backfill`. Inserts the
 * milestone events (`signup`, `take_uploaded`, `take_ready`, `ai_edit_used`) that existing users
 * and takes should already have, each with the real row's own time, in batches until nothing is
 * missing. It is the same repair the cleanup sweep runs, so it is safe to run again: a second run
 * finds nothing. Prints counts only, never an ID, email or title. It uses the same guard as
 * `pnpm usage:reconcile`: a database that is not on this machine is refused unless the run is in
 * CI or `MIGRATE_TARGET=prod`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { REPAIR_BATCH, repairAnalyticsEvents } from "../src/db/data/analytics-repair";
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
    `Refusing to backfill the non local database host ${host}. Use a local database, or set MIGRATE_TARGET=prod on purpose.`,
  );
}
console.log(`backfill-analytics → ${host}${local ? " (local)" : ""}`);

const client = postgres(env.DATABASE_URL_DIRECT, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });

try {
  const total = { signup: 0, take_uploaded: 0, take_ready: 0, ai_edit_used: 0 };
  for (;;) {
    const added = await repairAnalyticsEvents(db, REPAIR_BATCH);
    const batch = Object.values(added).reduce((sum, n) => sum + n, 0);
    for (const name of Object.keys(total) as (keyof typeof total)[]) total[name] += added[name];
    if (batch === 0) break;
  }
  console.log(
    `backfill-analytics: ${total.signup} signup, ${total.take_uploaded} take_uploaded, ${total.take_ready} take_ready, ${total.ai_edit_used} ai_edit_used added`,
  );
} finally {
  await client.end();
}
