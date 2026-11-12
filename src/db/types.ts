import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema";

/** A Drizzle database over postgres.js with the shared schema (web or job client). */
export type Db = PostgresJsDatabase<typeof schema>;

/** A transaction opened on `Db`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Either a database or an open transaction: functions taking this compose into one tx. */
export type Executor = Db | Tx;

export type Take = typeof schema.take.$inferSelect;
export type ProcessingJob = typeof schema.processingJob.$inferSelect;
export type JobStep = typeof schema.jobStep.$inferSelect;
export type Render = typeof schema.render.$inferSelect;
export type Transcript = typeof schema.transcript.$inferSelect;
export type Background = typeof schema.background.$inferSelect;
export type BackgroundPreview = typeof schema.backgroundPreview.$inferSelect;

/** Postgres SQLSTATE of an error from postgres.js, also when Drizzle wraps it. */
export function pgErrorCode(error: unknown): { code?: string; constraint?: string } {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && "code" in candidate) {
      const { code, constraint_name: constraint } = candidate as {
        code?: unknown;
        constraint_name?: unknown;
      };
      if (typeof code === "string") {
        return { code, constraint: typeof constraint === "string" ? constraint : undefined };
      }
    }
  }
  return {};
}
