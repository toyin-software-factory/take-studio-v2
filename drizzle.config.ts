import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations always use the direct (non pooled) Neon URL (spec 0001).
const url =
  process.env.DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/take_studio";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
