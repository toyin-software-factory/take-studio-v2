import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../schema";
import type { Db, Take } from "../types";

/**
 * Test only: a real Postgres for data function tests. Uses its own database
 * (`take_studio_test`), creates it when missing and applies the committed migrations,
 * so tests run before CI's "Apply migrations" step and never touch app data.
 * Refuses any host but localhost: sandboxes carry production URLs in their env.
 */

const DEFAULT_URL = "postgres://postgres:postgres@localhost:5432/take_studio_test";
const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const LOCK_ID = 7_311_002; // any constant: serialises migrations across test workers

function testUrl(database?: string): URL {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_URL);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error(`Test database must be on localhost, got ${url.hostname}.`);
  }
  if (database !== undefined) {
    if (!/^take_studio_test_[a-z0-9_]+$/.test(database)) {
      throw new Error(`Separate test databases must be named take_studio_test_<name>.`);
    }
    url.pathname = `/${database}`;
  }
  return url;
}

/** Creates the test database when missing. Safe when several test workers race. */
async function ensureDatabase(url: URL): Promise<void> {
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    try {
      await sql`select 1`;
    } catch (error) {
      throw new Error(
        `Can't reach the test Postgres at ${url.host}. Start it with \`pnpm db:up\`. (${String(error)})`,
      );
    }
    const [found] = await sql`select 1 from pg_database where datname = ${name}`;
    if (!found) {
      await sql.unsafe(`create database "${name.replaceAll('"', '""')}"`).catch((error) => {
        // Another test worker created it first: 42P04 (duplicate_database), or 23505 when
        // both inserts into pg_database race.
        const code = (error as { code?: string }).code;
        if (code !== "42P04" && code !== "23505") throw error;
      });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export type TestDb = { readonly db: Db; readonly close: () => Promise<void> };

/**
 * Opens a migrated test database. Call `close` in `afterAll`. Pass `database`
 * (`take_studio_test_<name>`) for tests that sweep whole tables (cleanup, the deletion queue),
 * so they can't touch rows other test files are using at the same time.
 */
export async function openTestDb(options: { readonly database?: string } = {}): Promise<TestDb> {
  const url = testUrl(options.database);
  await ensureDatabase(url);

  const lockClient = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await lockClient`select pg_advisory_lock(${LOCK_ID})`;
    await migrate(drizzle(lockClient), { migrationsFolder: MIGRATIONS });
    await lockClient`select pg_advisory_unlock(${LOCK_ID})`;
  } finally {
    await lockClient.end({ timeout: 5 });
  }

  const client = postgres(url.toString(), { max: 6, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

/** Inserts a creator (Better Auth user) with a unique ID and email. */
export async function createCreator(
  db: Db,
  email?: string,
): Promise<{ id: string; email: string }> {
  const id = `test-${crypto.randomUUID()}`;
  const address = email ?? `${id}@example.com`;
  await db.insert(schema.user).values({ id, name: "Test creator", email: address });
  return { id, email: address };
}

/** Inserts a take directly in any state (bypasses the upload flow). */
export async function seedTake(
  db: Db,
  creatorId: string,
  overrides: Partial<typeof schema.take.$inferInsert> = {},
): Promise<Take> {
  const id = overrides.id ?? crypto.randomUUID();
  const [row] = await db
    .insert(schema.take)
    .values({
      id,
      creatorId,
      title: "Seeded take",
      status: "uploaded",
      originalKey: `originals/${id}/source.mp4`,
      originalBytes: 1_000_000,
      container: "mp4",
      durationMs: 61_500,
      width: 1920,
      height: 1080,
      videoExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("seedTake inserted nothing");
  return row;
}
