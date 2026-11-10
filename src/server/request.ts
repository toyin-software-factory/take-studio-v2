import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createWebDb } from "@/db/client/web";
import { parseWebEnv } from "@/lib/env";
import { createAuth } from "./auth";

/** Per request database client over the Hyperdrive binding. */
export async function getDb() {
  const { env } = await getCloudflareContext({ async: true });
  return createWebDb(env.HYPERDRIVE);
}

/** Per request Better Auth instance, sharing the request's database client. */
export async function getAuth() {
  return createAuth(await getDb(), parseWebEnv());
}
