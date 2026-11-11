import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { guardDbTarget } from "./scripts/db-guard";

// Migrations always use the direct (non pooled) Neon URL (spec 0001).
const url =
  process.env.DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/take_studio";

// Refuse a remote database outside CI unless MIGRATE_TARGET=prod (see scripts/db-guard.ts).
// Covers every command that loads this file (all `pnpm db:*` scripts), not `--url` CLI runs.
guardDbTarget(url);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
