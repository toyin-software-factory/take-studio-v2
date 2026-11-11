import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { WebEnv } from "@/lib/env";
import { beforeDeleteUser } from "./account";

type AuthEnv = Pick<
  WebEnv,
  "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"
>;

/**
 * Better Auth, Google sign in only for the scaffold (email magic link comes with slice 1).
 * Built per request around the per request Hyperdrive client: see `getAuth` in ./request.ts.
 */
export function createAuth(db: PostgresJsDatabase<typeof schema>, env: AuthEnv) {
  return betterAuth({
    appName: "Take Studio",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    user: {
      // Spec 0002, AC-17: the creator's takes, rows and files go before the user row.
      deleteUser: { enabled: true, beforeDelete: beforeDeleteUser(db) },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
