import { sql as rawSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

export type JobDb = ReturnType<typeof drizzle<typeof schema>>;

const FIRST_CONNECT_ATTEMPTS = 3;
const FIRST_CONNECT_DELAY_MS = 1_000;

/**
 * Job client: opened and closed inside each Trigger.dev task, over the Neon pooled URL.
 * Retries the first connect because Neon wakes from scale to zero in about a second.
 */
export async function withJobDb<T>(databaseUrl: string, fn: (db: JobDb) => Promise<T>): Promise<T> {
  const client = postgres(databaseUrl, { max: 2, connect_timeout: 10 });
  const db = drizzle(client, { schema });
  try {
    await connectWithRetry(db);
    return await fn(db);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function connectWithRetry(db: JobDb): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(rawSql`select 1`);
      return;
    } catch (error) {
      if (attempt >= FIRST_CONNECT_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, FIRST_CONNECT_DELAY_MS * attempt));
    }
  }
}
