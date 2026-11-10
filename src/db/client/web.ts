import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

/**
 * Web app client: one per request, over the Hyperdrive binding.
 * Never hold this in a module level variable: Workers forbid sharing I/O across requests.
 */
export function createWebDb(hyperdrive: { connectionString: string }) {
  const sql = postgres(hyperdrive.connectionString, {
    // Hyperdrive pools for us; keep the per request client small.
    max: 5,
    // Avoids an extra round trip on every new connection.
    fetch_types: false,
  });
  return drizzle(sql, { schema });
}

export type WebDb = ReturnType<typeof createWebDb>;
