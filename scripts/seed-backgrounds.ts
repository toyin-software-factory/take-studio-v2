/**
 * Installs the built in studio backgrounds (spec 0008, AC-7): uploads each image and its
 * thumbnail from `assets/backgrounds/` to R2 and upserts its `background` row with a fixed ID,
 * so the script is safe to run again. Local runs: `pnpm db:seed` (the same guard as the
 * `pnpm db:*` scripts: a database that is not on this machine is refused unless the run is in
 * CI or `MIGRATE_TARGET=prod`). Needs the R2 variables and `DATABASE_URL_DIRECT`.
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../src/db/schema";
import { createR2 } from "../src/lib/r2";
import { BUILT_IN_BACKGROUNDS, builtInKeys } from "./built-in-backgrounds";

const env = z
  .object({
    DATABASE_URL_DIRECT: z.url(),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    CI: z.string().optional(),
    MIGRATE_TARGET: z.enum(["prod"]).optional(),
  })
  .parse(process.env);

const host = new URL(env.DATABASE_URL_DIRECT).hostname;
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
// Only the exact values authorise a remote database: CI "false" or "1" does not.
if (!local && env.CI !== "true" && env.MIGRATE_TARGET !== "prod") {
  throw new Error(
    `Refusing to seed the non local database host ${host}. Use a local database, or set MIGRATE_TARGET=prod on purpose.`,
  );
}
console.log(`seed-backgrounds → ${host}${local ? " (local)" : ""}`);

const client = postgres(env.DATABASE_URL_DIRECT, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });
const r2 = createR2(env);
const file = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../assets/backgrounds/${name}`, import.meta.url)));

try {
  for (const b of BUILT_IN_BACKGROUNDS) {
    const keys = builtInKeys(b.slug);
    await r2.putObject(keys.imageKey, file(`${b.slug}.jpg`), "image/jpeg");
    await r2.putObject(keys.thumbKey, file(`${b.slug}.webp`), "image/webp");
    const values = {
      creatorId: null,
      name: b.name,
      sourceKey: null,
      imageKey: keys.imageKey,
      thumbKey: keys.thumbKey,
      width: b.width,
      height: b.height,
      status: "ready",
      failureCode: null,
      alt: b.alt,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.background)
      .values({ id: b.id, ...values })
      .onConflictDoUpdate({ target: schema.background.id, set: values });
    console.log(`  ${b.slug}: installed`);
  }
} finally {
  await client.end();
}
