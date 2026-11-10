// Only for the Better Auth CLI (`pnpm auth:generate`), which needs a module that exports `auth`.
// Never imported by the app: the app builds auth per request (./request.ts).
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { createAuth } from "./auth";

export const auth = createAuth(drizzle.mock({ schema }), {
  BETTER_AUTH_SECRET: "cli-only-placeholder-secret-0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "cli",
  GOOGLE_CLIENT_SECRET: "cli",
});
